/**
 * Unit tests for the RAG embedder — the deterministic, no-LLM-required
 * piece. The Mongo-backed index, ingest, and search are exercised by
 * integration tests (they need a live database to assert against).
 *
 * History: this file used to also test the in-memory buildIndex/getIndex
 * API. That API was removed when the RAG store moved to MongoDB
 * (knowledge_documents + knowledge_chunks collections) so the same
 * index can survive restarts and so per-user uploads are first-class.
 */
import { hashEmbedder, cosineSimilarity } from '../../../src/liuyao/rag/index';

describe('hashEmbedder', () => {
  it('returns a fixed-dimension normalized vector', () => {
    const v = hashEmbedder('hello world');
    expect(v).toHaveLength(64);
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic — same input → same vector', () => {
    const a = hashEmbedder('六爻装卦 纳甲');
    const b = hashEmbedder('六爻装卦 纳甲');
    expect(a).toEqual(b);
  });

  it('cosine of identical texts is 1', () => {
    const a = hashEmbedder('六爻装卦');
    const b = hashEmbedder('六爻装卦');
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it('orthogonal-ish texts score below 1', () => {
    const a = hashEmbedder('六爻 纳甲 装卦');
    const b = hashEmbedder('banana smoothie recipe');
    expect(cosineSimilarity(a, b)).toBeLessThan(0.5);
  });

  it('handles empty input without throwing', () => {
    const v = hashEmbedder('');
    expect(v).toHaveLength(64);
    // Empty input → zero vector → divide-by-zero guard returns the
    // zero vector (which is then treated as "no signal" by cosine).
    expect(v.every((x) => x === 0)).toBe(true);
  });
});
