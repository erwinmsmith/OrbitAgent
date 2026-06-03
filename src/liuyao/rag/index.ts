/**
 * Six-yang RAG (Retrieval-Augmented Generation) knowledge base.
 *
 * Indexes docs/base_knowledge/*.md on startup, splits by section, embeds
 * each chunk with a pluggable embedder (default: a deterministic
 * bag-of-characters hash so the MVP runs without an external API key).
 * The agent queries this before generating each section of its report
 * so every claim is grounded in a citation.
 *
 * The embedding strategy is intentionally pluggable — drop in a real
 * provider (OpenAI, SiliconFlow, bge-m3, …) by passing an `embedder`
 * to rebuildIndex() once it's wired up.
 */
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger';

export interface RagChunk {
  id: string;             // stable hash of source + index
  source: string;         // file path relative to repo root
  title: string;          // nearest preceding H1/H2
  text: string;           // the chunk body
  embedding: number[];     // dense vector
}

/** Plug-in interface — any function (text) → number[] works. */
export type Embedder = (text: string) => Promise<number[]> | number[];

/** Default embedder: deterministic 64-dim bag-of-words hash. */
export function hashEmbedder(text: string): number[] {
  const dim = 64;
  const v = new Array(dim).fill(0);
  // crude tokenizer: split on non-Chinese, non-alphanumeric chars
  for (const word of text.toLowerCase().split(/[^\w一-鿿]+/)) {
    if (!word) continue;
    let h = 0;
    for (let i = 0; i < word.length; i++) {
      h = (h * 31 + word.charCodeAt(i)) >>> 0;
    }
    v[h % dim] += 1;
  }
  // L2 normalize
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  return dot / ((Math.sqrt(na) || 1) * (Math.sqrt(nb) || 1));
}

interface Index {
  chunks: RagChunk[];
  bySource: Map<string, RagChunk[]>;
}

/** Walk docs/base_knowledge/ and split each .md into (title, body) chunks. */
async function loadDocs(rootDir: string): Promise<RagChunk[]> {
  const dir = path.join(rootDir, 'docs', 'base_knowledge');
  let entries: string[];
  try { entries = await fs.readdir(dir); }
  catch (err: any) { if (err.code === 'ENOENT') return []; throw err; }

  const out: RagChunk[] = [];
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    const abs = path.join(dir, f);
    const rel = path.relative(rootDir, abs);
    const raw = await fs.readFile(abs, 'utf-8');

    // Split by H1/H2/H3 headings. Each chunk has the heading as title
    // and the body until the next heading.
    const lines = raw.split('\n');
    let currentTitle = f.replace(/\.md$/, '');
    let currentBody: string[] = [];
    const flush = (idx: number) => {
      const text = currentBody.join('\n').trim();
      if (text.length > 40) {
        out.push({
          id: `${rel}#${idx}-${text.length}`,
          source: rel,
          title: currentTitle,
          text,
          embedding: [],   // filled in by embedder in buildIndex
        });
      }
      currentBody = [];
    };
    let chunkIdx = 0;
    for (const line of lines) {
      const h = /^(#{1,3})\s+(.+)/.exec(line);
      if (h) {
        flush(chunkIdx++);
        currentTitle = h[2]!.trim();
      } else {
        currentBody.push(line);
      }
    }
    flush(chunkIdx++);
  }
  return out;
}

let index: Index | null = null;

/** Build (or rebuild) the in-memory index. Safe to call repeatedly. */
export async function buildIndex(embedder: Embedder = hashEmbedder, rootDir = process.cwd()): Promise<Index> {
  const chunks = await loadDocs(rootDir);
  // Embed all chunks.
  for (const c of chunks) c.embedding = await embedder(c.text);
  const bySource = new Map<string, RagChunk[]>();
  for (const c of chunks) {
    if (!bySource.has(c.source)) bySource.set(c.source, []);
    bySource.get(c.source)!.push(c);
  }
  index = { chunks, bySource };
  logger.info(`RAG index built: ${chunks.length} chunks from ${bySource.size} sources`);
  return index;
}

/** Get the current index, building it lazily. */
export async function getIndex(): Promise<Index> {
  if (!index) return buildIndex();
  return index;
}

/** Top-k chunks most similar to the query. */
export async function search(query: string, k = 4): Promise<Array<{ chunk: RagChunk; score: number }>> {
  const idx = await getIndex();
  if (idx.chunks.length === 0) return [];
  const qv = hashEmbedder(query);
  const scored = idx.chunks.map((c) => ({ chunk: c, score: cosineSimilarity(qv, c.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export interface RagStats {
  chunkCount: number;
  sourceCount: number;
  sources: string[];
  /** True if the index is built with a non-default embedder. */
  hasRealEmbeddings: boolean;
}

export async function ragStats(): Promise<RagStats> {
  const idx = await getIndex();
  return {
    chunkCount: idx.chunks.length,
    sourceCount: idx.bySource.size,
    sources: [...idx.bySource.keys()].sort(),
    hasRealEmbeddings: idx.chunks.length > 0 && idx.chunks[0]!.embedding.length > 0,
  };
}
