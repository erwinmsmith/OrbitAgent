/**
 * Multi-user isolation tests for the new Mongo-backed ChartStore and RAG.
 *
 * These tests assert the contracts we just added when moving the chart
 * store off Redis and the RAG off its in-memory index:
 *
 *   1. User A stores a chart under sessionId=X → user B cannot see that
 *      sessionId's chart keys, and cannot pull the chart back via the
 *      analyze endpoint, even when they know the sessionId.
 *   2. User A uploads a user-scope RAG document → user B's search for
 *      the same query returns NONE of A's chunks; user A's search does.
 *   3. Admin (user A here) sees system + own user-scope chunks;
 *      non-admin (user B) sees system + own user-scope only.
 *
 * Hits the real Express app via supertest with real Mongo + Redis on
 * localhost. Cleanup runs in afterAll so the dev DB stays clean for
 * the next run.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import application from '../../src/app';
import { generateToken } from '../../src/middleware/auth';
import { UserModel } from '../../src/models/User';
import { DivinationChartModel } from '../../src/models/DivinationChart';
import { KnowledgeDocumentModel } from '../../src/models/KnowledgeDocument';
import { KnowledgeChunkModel } from '../../src/models/KnowledgeChunk';

const app = application.getApp();

const USER_A_EMAIL = 'isolation-a@test.local';
const USER_B_EMAIL = 'isolation-b@test.local';
const SHARED_PASSWORD = 'isolation-pw-12345';
const TEST_SESSION = 'sess_isolation_test';

let tokenA = '';
let userAId = '';
let tokenB = '';
let userBId = '';
let tokenAAdmin = ''; // user A is also an admin so we can verify the
                       // admin-widened RAG path in the same suite.

beforeAll(async () => {
  await application.initialize();

  // Pre-clean: drop any leftover state from a previous run.
  // User-scope RAG docs are namespaced as "user:<ownerId>/<filename>",
  // so the cleanup uses a regex on `source` to catch them regardless of
  // the ownerId that was generated last time.
  await UserModel.deleteMany({ email: { $in: [USER_A_EMAIL, USER_B_EMAIL] } });
  await DivinationChartModel.deleteMany({ sessionId: TEST_SESSION });
  await KnowledgeDocumentModel.deleteMany({ source: /isolation-test\.md$/ });
  await KnowledgeChunkModel.deleteMany({ source: /isolation-test\.md$/ });

  // Create two fresh users. User A is admin (so we can test the
  // admin-widened RAG visibility path) — user B is a plain user.
  const hashed = await bcrypt.hash(SHARED_PASSWORD, 8);
  const [a, b] = await UserModel.create([
    { email: USER_A_EMAIL, username: 'isolation-a', password: hashed, isAdmin: true },
    { email: USER_B_EMAIL, username: 'isolation-b', password: hashed, isAdmin: false },
  ]);
  userAId = String(a._id);
  userBId = String(b._id);
  tokenA = generateToken({ id: userAId, email: USER_A_EMAIL, isAdmin: true });
  tokenAAdmin = tokenA;
  tokenB = generateToken({ id: userBId, email: USER_B_EMAIL, isAdmin: false });
});

afterAll(async () => {
  // Clean up everything we touched.
  await DivinationChartModel.deleteMany({ sessionId: TEST_SESSION });
  await KnowledgeDocumentModel.deleteMany({ source: /isolation-test\.md$/ });
  await KnowledgeChunkModel.deleteMany({ source: /isolation-test\.md$/ });
  await UserModel.deleteMany({ email: { $in: [USER_A_EMAIL, USER_B_EMAIL] } });
  await application.stop();
});

// ─── ChartStore isolation ────────────────────────────────────────────
describe('ChartStore — per-user isolation', () => {
  it('lets user A store a chart on session X', async () => {
    const r = await request(app)
      .post('/api/v1/divination/chart')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        bits: [0, 1, 1, 0, 1, 1],
        sessionId: TEST_SESSION,
        question: '求财',
        dayStem: '甲',
        dayBranch: '子',
      });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.sessionId).toBe(TEST_SESSION);
    // The /chart response spreads the ChartResult fields at the top of
    // `data` (not under `data.chart`). Assert the structured fields
    // directly instead.
    expect(r.body.data.originalHexagram).toBeDefined();
    expect(r.body.data.lines).toBeDefined();
  });

  it('lets user A list chart keys for session X', async () => {
    const r = await request(app)
      .get(`/api/v1/divination/chart/keys/${TEST_SESSION}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(r.status).toBe(200);
    expect(r.body.data.keys).toEqual(expect.arrayContaining(['default']));
  });

  it('returns an empty key list to user B for session X (cross-user leak check)', async () => {
    const r = await request(app)
      .get(`/api/v1/divination/chart/keys/${TEST_SESSION}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(r.status).toBe(200);
    // B is authenticated, so the route succeeds — but the userId-scoped
    // store lookup should return no keys for them. This is the critical
    // assertion: a user with knowledge of sessionId X cannot see A's keys.
    expect(r.body.data.keys).toEqual([]);
  });

  it('returns 404 to user B when they try to analyze A\'s chart via sessionId', async () => {
    const r = await request(app)
      .post('/api/v1/divination/analyze')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ sessionId: TEST_SESSION });
    // The store lookup throws (CHART_NOT_FOUND) because the chart
    // exists but is not owned by user B.
    expect(r.status).toBe(404);
    expect(r.body.error?.code).toBe('CHART_NOT_FOUND');
  });

  it('lets user A analyze their own chart via sessionId', async () => {
    const r = await request(app)
      .post('/api/v1/divination/analyze')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ sessionId: TEST_SESSION });
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveProperty('summary');
  });

  it('requires authentication (no JWT → 401)', async () => {
    const r = await request(app)
      .get(`/api/v1/divination/chart/keys/${TEST_SESSION}`);
    expect(r.status).toBe(401);
  });
});

// ─── RAG isolation ───────────────────────────────────────────────────
describe('RAG — per-user document scoping', () => {
  it('lets user A upload a user-scope markdown document', async () => {
    const r = await request(app)
      .post('/api/v1/divination/rag/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        filename: 'isolation-test.md',
        body: '# 隔离测试\n\n这是一段专属于 user A 的 RAG 内容。关键词：isolation-keyword-zzzzz。',
        scope: 'user',
      });
    expect(r.status).toBe(200);
    expect(r.body.data.scope).toBe('user');
    expect(r.body.data.ownerId).toBe(userAId);
    expect(r.body.data.chunkCount).toBeGreaterThan(0);
  });

  it('user A can search and find their own user-scope chunk', async () => {
    const r = await request(app)
      .post('/api/v1/divination/rag/search')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ query: 'isolation-keyword-zzzzz', k: 5 });
    expect(r.status).toBe(200);
    const sources = (r.body.data as any[]).map((c) => c.source);
    // User-scope docs are stored under source = "user:<ownerId>/<filename>".
    expect(sources).toEqual(expect.arrayContaining([`user:${userAId}/isolation-test.md`]));
  });

  it('user B searching the same query CANNOT see A\'s user-scope chunk', async () => {
    const r = await request(app)
      .post('/api/v1/divination/rag/search')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ query: 'isolation-keyword-zzzzz', k: 5 });
    expect(r.status).toBe(200);
    const sources = (r.body.data as any[]).map((c) => c.source);
    // The key assertion: B's results must NOT include A's private doc,
    // even though B knows the query string.
    expect(sources).not.toEqual(expect.arrayContaining([`user:${userAId}/isolation-test.md`]));
  });

  it('admin (user A) sees their user-scope doc in /rag/list', async () => {
    const r = await request(app)
      .get('/api/v1/divination/rag/list')
      .set('Authorization', `Bearer ${tokenAAdmin}`);
    expect(r.status).toBe(200);
    const sources = (r.body.data.sources as any[]).map((s) => s.source);
    expect(sources).toEqual(expect.arrayContaining([`user:${userAId}/isolation-test.md`]));
  });

  it('user B does NOT see A\'s user-scope doc in /rag/list', async () => {
    const r = await request(app)
      .get('/api/v1/divination/rag/list')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(r.status).toBe(200);
    const sources = (r.body.data.sources as any[]).map((s) => s.source);
    expect(sources).not.toEqual(expect.arrayContaining([`user:${userAId}/isolation-test.md`]));
  });

  it('user B CANNOT delete A\'s user-scope doc (returns DOC_NOT_FOUND)', async () => {
    // B sends a bare filename — the server tries B's user-scope first,
    // which doesn't exist for B, so the delete returns 404. (Even if
    // B guessed the fully-qualified source, the per-user ownership
    // check inside deleteDocument would still reject them.)
    const r = await request(app)
      .delete('/api/v1/divination/rag/isolation-test.md')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(r.status).toBe(404);
    expect(r.body.error?.code).toBe('DOC_NOT_FOUND');
    // Confirm the doc is still there for A.
    const list = await request(app)
      .get('/api/v1/divination/rag/list')
      .set('Authorization', `Bearer ${tokenA}`);
    const sources = (list.body.data.sources as any[]).map((s) => s.source);
    expect(sources).toEqual(expect.arrayContaining([`user:${userAId}/isolation-test.md`]));
  });

  it('user A CAN delete their own user-scope doc by bare filename', async () => {
    // Bare filename is resolved against the caller's own user-scope.
    const r = await request(app)
      .delete('/api/v1/divination/rag/isolation-test.md')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(r.status).toBe(200);
    // The resolved (fully-qualified) source is echoed back.
    expect(r.body.data.source).toBe(`user:${userAId}/isolation-test.md`);
    // And the doc is now gone.
    const list = await request(app)
      .get('/api/v1/divination/rag/list')
      .set('Authorization', `Bearer ${tokenA}`);
    const sources = (list.body.data.sources as any[]).map((s) => s.source);
    expect(sources).not.toEqual(expect.arrayContaining([`user:${userAId}/isolation-test.md`]));
  });
});
