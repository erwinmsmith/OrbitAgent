/**
 * Six-yang RAG (Retrieval-Augmented Generation) knowledge base.
 *
 * Storage: MongoDB collections `knowledge_documents` and
 * `knowledge_chunks`. NOT Redis — these are user data and must
 * survive restarts.
 *
 * Per-user isolation:
 *   - A document is either system-scope (ownerId: null, ships with
 *     docs/base_knowledge/*.md and any admin uploads) or
 *     user-scope (ownerId: <userId>, uploaded by that user).
 *   - Searches union system-scope chunks and the requesting user's
 *     own chunks. Other users' private uploads are NEVER included.
 *
 * The embedding strategy is pluggable via the `ORBIT_EMBEDDER` env
 * var. Current options:
 *   - `hash` (default) — deterministic 64-dim BoW hash. Works
 *     without an external API key; quality is mediocre.
 *   - `remote-zhipu` — 智谱 Embedding-3 via the OpenAI-compatible
 *     /embeddings endpoint at open.bigmodel.cn. Costs 0.5元/Mtok.
 *     Set `ZHIPU_API_KEY` to use.
 */
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { KnowledgeDocumentModel, type KnowledgeScope } from '../../models/KnowledgeDocument';
import { KnowledgeChunkModel } from '../../models/KnowledgeChunk';
import { logger } from '../../utils/logger';

export interface RagChunk {
  id: string;              // stable id (documentId + ':' + index)
  source: string;          // mirror of doc.source
  title: string;           // section title
  text: string;            // chunk body
  embedding: number[];
  scope: KnowledgeScope;
}

export type Embedder = (text: string) => Promise<number[]> | number[];

/** Default embedder: deterministic 64-dim bag-of-words hash. */
export function hashEmbedder(text: string): number[] {
  const dim = 64;
  const v = new Array(dim).fill(0);
  for (const word of text.toLowerCase().split(/[^\w一-鿿]+/)) {
    if (!word) continue;
    let h = 0;
    for (let i = 0; i < word.length; i++) {
      h = (h * 31 + word.charCodeAt(i)) >>> 0;
    }
    v[h % dim] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

/**
 * 智谱 AI Embedding-3 adapter. Calls
 * `POST https://open.bigmodel.cn/api/paas/v4/embeddings` with the
 * OpenAI-compatible body shape. Honors an in-process LRU cache so
 * repeated searches for the same query don't re-charge the API.
 *
 *   env: ZHIPU_API_KEY            (required)
 *        ORBIT_EMBEDDER=remote-zhipu
 *        ZHIPU_EMBED_MODEL=embedding-3   (default)
 *        ZHIPU_EMBED_DIM=2048             (default — also accepts 1024/512/256)
 */
const _zhipuEmbedCache = new Map<string, number[]>();
const _ZHIPU_CACHE_MAX = 1024;

function _zhipuCacheGet(key: string): number[] | undefined {
  return _zhipuEmbedCache.get(key);
}
function _zhipuCacheSet(key: string, vec: number[]): void {
  if (_zhipuEmbedCache.size >= _ZHIPU_CACHE_MAX) {
    // Drop the oldest insertion (Map iteration is insertion-ordered).
    const first = _zhipuEmbedCache.keys().next().value;
    if (first !== undefined) _zhipuEmbedCache.delete(first);
  }
  _zhipuEmbedCache.set(key, vec);
}

export function zhipuEmbedder(model: string = 'embedding-3', dim?: number): Embedder {
  const apiKey = process.env.ZHIPU_API_KEY ?? '';
  if (!apiKey) {
    throw new Error('zhipuEmbedder: ZHIPU_API_KEY is not set');
  }
  const baseUrl = process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
  const client = axios.create({
    baseURL: baseUrl,
    timeout: 30_000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  });
  return async (text: string): Promise<number[]> => {
    const key = `${model}::${dim ?? 'd'}::${text}`;
    const cached = _zhipuCacheGet(key);
    if (cached) return cached;
    // Embedding-3's per-input token limit is 3072. Approximate the
    // text's token count as chars/2 (CJK chars are usually ~1-2
    // tokens, ASCII ~0.3 tokens; chars/2 is a safe over-estimate
    // for mixed content). If we exceed, truncate to 3000 chars
    // (≈1500 tokens, well under the limit) — losing the tail is
    // better than refusing to embed the doc at all.
    const safeText = text.length > 3000 ? text.slice(0, 3000) : text;
    const body: Record<string, unknown> = {
      model,
      input: [safeText],               // Embedding-3 supports array input
    };
    if (dim) body.dimensions = dim;
    let r;
    try {
      r = await client.post<{ data: Array<{ embedding: number[] }> }>('/embeddings', body);
    } catch (e: any) {
      const status = e.response?.status;
      const errBody = e.response?.data;
      const preview = typeof errBody === 'string'
        ? errBody.slice(0, 200)
        : JSON.stringify(errBody).slice(0, 200);
      throw new Error(
        `zhipu embed failed (status=${status}, model=${model}, ` +
        `textLen=${text.length}): ${preview}`,
      );
    }
    const vec = r.data.data?.[0]?.embedding;
    if (!vec || vec.length === 0) {
      throw new Error(`zhipuEmbedder: empty embedding response (model=${model})`);
    }
    _zhipuCacheSet(key, vec);
    return vec;
  };
}

/** Resolve the active embedder from env. Used by bootstrap + search
 *  to keep them in lock-step (a chunk embedded with hash but queried
 *  with zhipu produces a zero-similarity result). */
export function resolveEmbedder(): Embedder {
  const choice = (process.env.ORBIT_EMBEDDER || 'hash').toLowerCase();
  if (choice === 'remote-zhipu' || choice === 'zhipu') {
    const model = process.env.ZHIPU_EMBED_MODEL || 'embedding-3';
    const dimStr = process.env.ZHIPU_EMBED_DIM;
    const dim = dimStr ? parseInt(dimStr, 10) : undefined;
    try {
      return zhipuEmbedder(model, dim);
    } catch (e: any) {
      logger.warn(`Failed to init zhipu embedder (${e.message}); falling back to hash embedder`);
      return hashEmbedder;
    }
  }
  return hashEmbedder;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  return dot / ((Math.sqrt(na) || 1) * (Math.sqrt(nb) || 1));
}

/* ────────────────────────────────────────────────────────────────────
 * Document lifecycle
 * ──────────────────────────────────────────────────────────────────── */

function deriveTitle(body: string, filename: string): string {
  const m = /^#\s+(.+)/m.exec(body);
  return m ? m[1]!.trim() : filename;
}

function splitByHeadings(text: string): Array<{ title: string; body: string }> {
  const sections: Array<{ title: string; body: string }> = [];
  const lines = text.split('\n');
  let title = '';
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body.length > 40) sections.push({ title, body });
    buf = [];
  };
  for (const line of lines) {
    const h = /^(#{1,3})\s+(.+)/.exec(line);
    if (h) { flush(); title = h[2]!.trim(); }
    else buf.push(line);
  }
  flush();
  return sections;
}

/**
 * Ingest a markdown document: store the doc + chunk it + embed each
 * chunk + write chunks. Idempotent on the (scope, source) pair —
 * re-ingesting replaces the existing record.
 */
export async function ingestDocument(opts: {
  scope: KnowledgeScope;
  ownerId: string | null;
  filename: string;
  body: string;
  embedder?: Embedder;
  rootDir?: string;
}): Promise<{ documentId: string; chunkCount: number; source: string }> {
  if (opts.scope === 'system' && opts.ownerId !== null) {
    throw new Error('ingestDocument: system-scope docs must have ownerId=null');
  }
  if (opts.scope === 'user' && !opts.ownerId) {
    throw new Error('ingestDocument: user-scope docs require ownerId');
  }
  const emb = opts.embedder ?? hashEmbedder;
  const source =
    opts.scope === 'system'
      ? `docs/base_knowledge/${opts.filename}`.replace(/^\/+/, '')
      : `user:${opts.ownerId}/${opts.filename}`;

  const title = deriveTitle(opts.body, opts.filename);
  // Identify the embedder so future boots can detect when the
  // stored chunks were produced by a different embedder (e.g.
  // upgrading from hash-bow-64 to zhipu-2048 forces a full
  // re-ingest). contentHash is set by the caller (bootstrap) so
  // we don't hash twice.
  const embedderKey = emb === hashEmbedder ? 'hash-bow-64' : 'remote-zhipu';
  const doc = await KnowledgeDocumentModel.findOneAndUpdate(
    { source },
    {
      $set: {
        scope: opts.scope,
        ownerId: opts.ownerId,
        filename: opts.filename,
        title,
        body: opts.body,
        embedderKey,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  // Re-chunk: drop the old chunks for this doc, then re-insert.
  await KnowledgeChunkModel.deleteMany({ documentId: doc._id });

  const sections = splitByHeadings(opts.body);
  if (sections.length === 0) {
    // Empty / heading-only doc — store a single chunk so the doc still
    // shows up in /rag/list.
    sections.push({ title: title || opts.filename, body: opts.body.trim() || '(empty)' });
  }

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    const embedding = await emb(s.body);
    await KnowledgeChunkModel.create({
      documentId: doc._id,
      ownerId: doc.ownerId,
      scope: doc.scope,
      source: doc.source,
      sectionTitle: s.title,
      text: s.body,
      embedding,
      index: i,
    });
  }

  logger.info(`RAG: ingested ${opts.scope} doc ${source} (${sections.length} chunks)`);
  return { documentId: String(doc._id), chunkCount: sections.length, source };
}

/**
 * Compute a stable short hash of a string. Used by the RAG
 * bootstrap to skip re-embedding files whose body hasn't changed
 * since the last successful run. SHA-256 hex would be 64 chars;
 * we keep the first 16 chars of the hex digest which is plenty
 * for collision avoidance on a corpus of <10K docs. */
export function contentHash(s: string): string {
  // Use Node's built-in crypto (sync, fast). Avoids a dep.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(s, 'utf-8').digest('hex').slice(0, 16);
}

/**
 * One-time bootstrap: walk docs/base_knowledge/*.md and ingest each
 * as a system-scope document. Content-hash cached: only files
 * whose body hash has changed since the last successful run are
 * re-embedded. Files that exist in the DB but no longer on disk
 * are deleted (along with their chunks).
 *
 * If the configured embedder throws on its first call (e.g.
 * ORBIT_EMBEDDER=remote-zhipu but the ZHIPU_API_KEY is invalid),
 * the bootstrap falls back to the hash embedder so the system
 * corpus still gets ingested. The /rag/search path will then
 * also use hashEmbedder for the same query — we don't want a
 * half-loaded index where some chunks are zhipu-embedded and
 * others are hash-embedded.
 */
export async function bootstrapSystemKnowledge(
  embedder: Embedder = resolveEmbedder(),
  rootDir: string = process.cwd(),
): Promise<{
  ingested: number;
  skipped: number;
  deleted: number;
  chunkCount: number;
  sourceCount: number;
  embedderKey: string;
}> {
  const dir = path.join(rootDir, 'docs', 'base_knowledge');
  let entries: string[];
  try { entries = await fs.readdir(dir); }
  catch (err: any) { if (err.code === 'ENOENT') return { ingested: 0, skipped: 0, deleted: 0, chunkCount: 0, sourceCount: 0, embedderKey: 'none' }; throw err; }

  // Smoke-test the resolved embedder so we can fall back BEFORE
  // we start a multi-minute ingest.
  let activeEmbedder = embedder;
  let probeError: string | null = null;
  try {
    const probeVec = await Promise.resolve(embedder('__orbit_probe__'));
    if (!Array.isArray(probeVec) || probeVec.length === 0) {
      throw new Error('embedder returned empty vector');
    }
  } catch (e: any) {
    probeError = e.message ?? String(e);
    logger.warn(`bootstrapSystemKnowledge: embedder probe failed (${probeError}); falling back to hash embedder for this run + future /rag/search`);
    activeEmbedder = hashEmbedder;
  }
  const embedderKey = activeEmbedder === hashEmbedder ? 'hash-bow-64' : 'remote-zhipu';

  // Filter to .md files on disk.
  const mdFiles = entries.filter((f) => f.endsWith('.md'));

  // Index existing docs by source for fast lookup of stored
  // contentHash.
  const existing = await KnowledgeDocumentModel
    .find({ scope: 'system', ownerId: null })
    .select('source contentHash')
    .lean();
  const existingBySource = new Map<string, { contentHash?: string }>();
  for (const d of existing) existingBySource.set(d.source, d);

  let ingested = 0, skipped = 0, deleted = 0, chunkCount = 0;
  const onDiskSources = new Set<string>();

  for (const f of mdFiles) {
    const source = `docs/base_knowledge/${f}`.replace(/^\/+/, '');
    onDiskSources.add(source);
    const body = await fs.readFile(path.join(dir, f), 'utf-8');
    const h = contentHash(body);
    const prev = existingBySource.get(source);
    if (prev && prev.contentHash === h) {
      // Unchanged since last run — skip the (potentially
      // expensive) embedder call entirely. We still record the
      // current chunk count for the log.
      const prevChunks = await KnowledgeChunkModel.countDocuments({ source });
      skipped++;
      chunkCount += prevChunks;
      logger.debug(`bootstrap: skip ${source} (contentHash unchanged, ${prevChunks} chunks retained)`);
      continue;
    }
    // Content changed (or first time) — ingest. ingestDocument
    // upserts the doc and replaces its chunks in one transaction.
    // One bad doc must NOT kill the whole bootstrap, so we wrap
    // each ingest in its own try/catch and log + continue.
    try {
      const r = await ingestDocument({
        scope: 'system',
        ownerId: null,
        filename: f,
        body,
        embedder: activeEmbedder,
      });
      if (r.chunkCount > 0) {
        ingested++;
        chunkCount += r.chunkCount;
      }
      // Stamp the contentHash on the doc so the NEXT run can skip.
      await KnowledgeDocumentModel.updateOne(
        { source },
        { $set: { contentHash: h, embedderKey } },
      );
      logger.info(
        `bootstrap: ${prev ? 're-ingested' : 'ingested'} ${source} ` +
        `(${r.chunkCount} chunks, hash=${h})`,
      );
    } catch (e: any) {
      // Roll back the partial upsert: delete the doc (and any
      // chunks that ingestDocument inserted before throwing) so
      // the next run sees a clean state and can retry.
      await KnowledgeDocumentModel.deleteOne({ source });
      await KnowledgeChunkModel.deleteMany({ source });
      logger.error(
        `bootstrap: failed to ingest ${source} — ${e.message ?? e}. ` +
        `Doc and partial chunks were rolled back; will retry next boot.`,
      );
    }
  }

  // Drop system-scope docs that no longer have a file on disk.
  for (const d of existing) {
    if (!onDiskSources.has(d.source)) {
      await KnowledgeDocumentModel.deleteOne({ _id: d._id });
      await KnowledgeChunkModel.deleteMany({ source: d.source });
      deleted++;
      logger.info(`bootstrap: deleted orphan ${d.source}`);
    }
  }

  logger.info(
    `RAG bootstrap done: ${ingested} ingested, ${skipped} skipped ` +
    `(contentHash cache), ${deleted} deleted; embedder=${embedderKey}` +
    (probeError ? `; probe failed: ${probeError}` : ''),
  );
  return { ingested, skipped, deleted, chunkCount, sourceCount: mdFiles.length, embedderKey };
}

/** Delete a user-uploaded document (or any document if admin). */
export async function deleteDocument(
  ownerId: string | null,
  sourceOrFilename: string,
  isAdmin: boolean = false,
): Promise<{ deleted: boolean; source: string }> {
  // The caller can pass either a fully-qualified `source` (e.g.
  // "user:abc/foo.md" or "docs/base_knowledge/foo.md") or a bare
  // filename ("foo.md"). For bare filenames, prefer the caller's
  // own user-scope doc; fall back to system-scope. Admins can use
  // the fully-qualified form to disambiguate.
  let source = sourceOrFilename;
  if (!source.includes('/')) {
    const candidates = isAdmin
      ? [
          { scope: 'user' as const, ownerId },
          { scope: 'system' as const, ownerId: null },
        ]
      : [
          { scope: 'user' as const, ownerId },
        ];
    for (const c of candidates) {
      const full = c.scope === 'system'
        ? `docs/base_knowledge/${sourceOrFilename}`
        : `user:${c.ownerId}/${sourceOrFilename}`;
      const doc = await KnowledgeDocumentModel.findOne({ source: full });
      if (doc) { source = full; break; }
    }
  }

  const doc = await KnowledgeDocumentModel.findOne({ source });
  if (!doc) return { deleted: false, source };
  if (!isAdmin && doc.ownerId !== ownerId) {
    // Don't leak existence — same response shape whether the doc
    // doesn't exist or doesn't belong to the caller.
    return { deleted: false, source };
  }
  await KnowledgeChunkModel.deleteMany({ documentId: doc._id });
  await KnowledgeDocumentModel.deleteOne({ _id: doc._id });
  return { deleted: true, source: doc.source };
}

export interface RagStats {
  totalChunks: number;
  totalDocuments: number;
  systemChunks: number;
  userChunksForRequester: number;
  sources: Array<{ source: string; scope: KnowledgeScope; title: string }>;
}

export async function ragStats(
  requesterId: string,
  isAdmin: boolean = false,
): Promise<RagStats> {
  // Counts the chunks the requester can actually see.
  const match = isAdmin
    ? {}
    : { $or: [{ scope: 'system' as const }, { ownerId: requesterId }] };

  const [totalDocs, totalChunks, sysCount, userCount, sources] = await Promise.all([
    KnowledgeDocumentModel.countDocuments(match),
    KnowledgeChunkModel.countDocuments(match),
    KnowledgeChunkModel.countDocuments({ scope: 'system' }),
    KnowledgeChunkModel.countDocuments({ scope: 'user', ownerId: requesterId }),
    KnowledgeDocumentModel
      .find(match, { source: 1, scope: 1, title: 1, _id: 0 })
      .sort({ source: 1 })
      .lean(),
  ]);

  return {
    totalDocuments: totalDocs,
    totalChunks,
    systemChunks: sysCount,
    userChunksForRequester: userCount,
    sources: sources.map((s: any) => ({ source: s.source, scope: s.scope, title: s.title })),
  };
}

/**
 * Top-k chunks most similar to the query, scoped to the requester's
 * visibility (system + own user-scope). Other users' private uploads
 * are NEVER included.
 */
export async function search(
  query: string,
  k: number = 4,
  requesterId: string,
  isAdmin: boolean = false,
): Promise<Array<{ chunk: RagChunk; score: number }>> {
  const match = isAdmin
    ? {}
    : { $or: [{ scope: 'system' as const }, { ownerId: requesterId }] };

  const chunks = await KnowledgeChunkModel
    .find(match, { source: 1, sectionTitle: 1, text: 1, embedding: 1, scope: 1, _id: 0 })
    .lean();

  if (chunks.length === 0) return [];

  let qv: number[];
  try {
    qv = await Promise.resolve(resolveEmbedder()(query));
  } catch (e: any) {
    logger.warn(`rag.search: embedder failed (${e.message}); falling back to hash for this query`);
    qv = hashEmbedder(query);
  }
  const scored = chunks.map((c: any) => {
    const chunk: RagChunk = {
      id: `${c.source}#${c._id ?? ''}`,
      source: c.source,
      title: c.sectionTitle,
      text: c.text,
      embedding: c.embedding,
      scope: c.scope,
    };
    return { chunk, score: cosineSimilarity(qv, c.embedding ?? []) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * Multi-query RAG retrieval. Runs `search` once per query, then
 * dedupes hits by chunk id, keeping the highest score. Returns
 * per-query provenance (`hits[].query`) so the caller can show
 * "this citation came from the LLM-proposed query X".
 *
 * Used by the analysis agent's Step 1→2 handoff: the LLM proposes 2-3
 * queries during the understand step, and we union them with a few
 * auto-queries (hexagram name, 用神 relatives).
 */
export async function searchMany(
  queries: string[],
  k: number = 4,
  requesterId: string,
  isAdmin: boolean = false,
): Promise<Array<{
  query: string;
  hits: Array<{ chunk: RagChunk; score: number }>;
}>> {
  // Run queries in parallel — they're independent.
  const results = await Promise.all(
    queries.map(async (q) => ({
      query: q,
      hits: await search(q, k, requesterId, isAdmin).catch((e) => {
        logger.warn(`rag.searchMany: query "${q}" failed (${e?.message ?? e}); returning []`);
        return [];
      }),
    })),
  );
  return results;
}

/**
 * Flatten the output of `searchMany` into a deduped list, keeping the
 * highest score per chunk id. The returned list is sorted by score
 * desc, capped at `totalK`. Each entry carries `provenanceQueries[]`
 * so the caller can show "this chunk matched both `妻财持世` and
 * `求财` queries".
 */
export function dedupeManyHits(
  results: Array<{ query: string; hits: Array<{ chunk: RagChunk; score: number }> }>,
  totalK: number = 8,
): Array<{ chunk: RagChunk; score: number; provenanceQueries: string[] }> {
  const byId = new Map<string, { chunk: RagChunk; score: number; provenanceQueries: string[] }>();
  for (const { query, hits } of results) {
    for (const { chunk, score } of hits) {
      const existing = byId.get(chunk.id);
      if (!existing || existing.score < score) {
        byId.set(chunk.id, { chunk, score, provenanceQueries: [query] });
      } else if (existing.score === score) {
        existing.provenanceQueries.push(query);
      }
    }
  }
  const flat = Array.from(byId.values());
  flat.sort((a, b) => b.score - a.score);
  return flat.slice(0, totalK);
}
