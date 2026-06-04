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
 * The embedding strategy is pluggable — drop in a real provider
 * (OpenAI, SiliconFlow, bge-m3, …) by setting ORBIT_EMBEDDER at
 * startup. The current default is a deterministic 64-dim BoW hash
 * so the MVP runs without an external API key.
 */
import fs from 'fs/promises';
import path from 'path';
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
  const doc = await KnowledgeDocumentModel.findOneAndUpdate(
    { source },
    {
      $set: {
        scope: opts.scope,
        ownerId: opts.ownerId,
        filename: opts.filename,
        title,
        body: opts.body,
        embedderKey: 'hash-bow-64',
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
 * One-time bootstrap: walk docs/base_knowledge/*.md and ingest each
 * as a system-scope document. Safe to call repeatedly.
 */
export async function bootstrapSystemKnowledge(
  embedder: Embedder = hashEmbedder,
  rootDir: string = process.cwd(),
): Promise<{ ingested: number; chunkCount: number; sourceCount: number }> {
  const dir = path.join(rootDir, 'docs', 'base_knowledge');
  let entries: string[];
  try { entries = await fs.readdir(dir); }
  catch (err: any) { if (err.code === 'ENOENT') return { ingested: 0, chunkCount: 0, sourceCount: 0 }; throw err; }
  let ingested = 0;
  let chunkCount = 0;
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    const body = await fs.readFile(path.join(dir, f), 'utf-8');
    const r = await ingestDocument({
      scope: 'system',
      ownerId: null,
      filename: f,
      body,
      embedder,
    });
    if (r.chunkCount > 0) {
      ingested++;
      chunkCount += r.chunkCount;
    }
  }
  return { ingested, chunkCount, sourceCount: ingested };
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

  const qv = hashEmbedder(query);
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
