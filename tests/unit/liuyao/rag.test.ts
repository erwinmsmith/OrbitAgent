/**
 * Unit tests for the RAG index — the offline (no-LLM-required) version
 * powered by the deterministic hash embedder.
 */
import { buildIndex, search, ragStats, hashEmbedder, cosineSimilarity } from '../../../src/liuyao/rag/index';

describe('hashEmbedder', () => {
  it('returns a fixed-dimension normalized vector', () => {
    const v = hashEmbedder('hello world');
    expect(v).toHaveLength(64);
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
  it('cosine of identical texts is 1', () => {
    const a = hashEmbedder('六爻装卦');
    const b = hashEmbedder('六爻装卦');
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });
});

describe('RAG index', () => {
  beforeAll(async () => {
    await buildIndex();
  });

  it('indexes the knowledge base', async () => {
    const stats = await ragStats();
    expect(stats.chunkCount).toBeGreaterThan(0);
    expect(stats.sourceCount).toBeGreaterThan(0);
    expect(stats.sources).toEqual(expect.arrayContaining([expect.stringMatching(/装卦方法/)]));
  });

  it('finds relevant chunks for a 六爻 query', async () => {
    const top = await search('纳甲', 3);
    expect(top.length).toBeGreaterThan(0);
    expect(top[0]!.score).toBeGreaterThan(0);
    expect(top[0]!.chunk.text.length).toBeGreaterThan(0);
  });
});
