/**
 * /api/v1/divination/* — the public HTTP surface for the 六爻 engine.
 *
 * All routes (except /cast) scope reads and writes by the caller's
 * userId so that one user cannot see or modify another's data.
 * /cast is read-only with respect to the store so it doesn't
 * strictly need scoping, but we still pass userId for consistency
 * in the log.
 *
 * Routes:
 *   POST /cast                  — 6 raw bits → CastResult
 *   POST /chart                 — full chart; also PERSISTS to ChartStore
 *                                 under (userId, sessionId, chartKey)
 *   POST /analyze               — accepts {chart: ...} OR {sessionId}
 *                                 to read from the store (latter is what
 *                                 the agent uses). Runs the full
 *                                 multi-stage pipeline (brief → understand
 *                                 → RAG → synthesize). Pass `debug: true`
 *                                 to get the full timeline.
 *   GET  /brief/:sessionId      — read just the structured ChartBrief
 *                                 (the deterministic material that the
 *                                 analyze pipeline feeds to its first
 *                                 LLM call). No LLM cost.
 *   GET  /chart/keys/:sessionId — list stored chart keys for the
 *                                 caller's session
 *
 *   POST /rag/upload            — ingest a markdown document into the
 *                                 RAG index. User-scope: becomes
 *                                 ownerId=callerId. Admin-only: can
 *                                 also upload system-scope docs.
 *   GET  /rag/list              — list documents the caller can see
 *                                 (system + own user-scope)
 *   DELETE /rag/:source         — delete a doc the caller owns
 *                                 (or any if admin)
 *   GET  /rag/stats            — RAG index size + scope breakdown
 *   POST /rag/search           — top-k chunks for a query (scoped)
 *
 * The chart assembler records a `warnings[]` array on the response
 * so the caller can see exactly which skills threw `TodoError`s
 * (i.e. which tables in KNOWLEDGE_NEEDED.md still need to be filled
 * in).
 */
import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { castSkill } from '../liuyao/skills/castSkill';
import { assembleChart, type AssembleInput } from '../liuyao/skills/chartAssembler';
import { runAnalysisAgent } from '../liuyao/agent/analysisAgent';
import { buildChartBrief } from '../liuyao/agent/chartBrief';
import {
  search, ragStats, ingestDocument, deleteDocument, bootstrapSystemKnowledge,
  resolveEmbedder,
} from '../liuyao/rag/index';
import {
  saveChart, getChart, listChartKeys, getLatestChart,
} from '../core/memory/ChartStore';
import { HTTP_STATUS } from '../constants';
import { logger } from '../utils/logger';

const router = Router();

router.use(authMiddleware(true));

function userIdOrThrow(req: Request): string {
  const u = req.user?.userId || req.apiKey?.userId;
  if (!u) {
    throw new AppError('UNAUTHORIZED', 'User ID required (login first)', HTTP_STATUS.UNAUTHORIZED);
  }
  return u;
}

function isAdmin(req: Request): boolean {
  return !!req.user?.isAdmin;
}

// ─── POST /cast ───────────────────────────────────────────────────────
router.post('/cast', asyncHandler(async (req: Request, res: Response) => {
  const { bits, interpretation } = req.body || {};
  if (!Array.isArray(bits) || bits.length !== 6) {
    throw new AppError('VALIDATION_ERROR', 'bits must be an array of 6 entries (0 or 1)', HTTP_STATUS.BAD_REQUEST);
  }
  const result = castSkill({ bits: bits as [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1], interpretation });
  res.json({ success: true, data: result });
}));

// ─── POST /chart ──────────────────────────────────────────────────────
router.post('/chart', asyncHandler(async (req: Request, res: Response) => {
  const userId = userIdOrThrow(req);
  const body = req.body || {};
  // Normalize sessionId so 'sess demo user', 'sess_demo_user', and
  // 'sess-demo-user' all resolve to the same chart. Whitespace
  // inside the id is a common CLI mistake when the user forgets to
  // quote it; we'd rather collapse that than 404.
  const sessionId: string | undefined = typeof body.sessionId === 'string'
    ? body.sessionId.trim().replace(/\s+/g, '_')
    : body.sessionId;
  if (!sessionId) {
    throw new AppError('VALIDATION_ERROR',
      'sessionId is required — the chart is persisted under it so the liuyao agent can read it later',
      HTTP_STATUS.BAD_REQUEST);
  }
  const input: AssembleInput = {
    question: body.question,
    questionType: body.questionType,
    bits: body.bits,
    yaoValues: body.yaoValues,
    dayStem: body.dayStem,
    dayBranch: body.dayBranch,
    monthBranch: body.monthBranch,
    hourStem: body.hourStem,
    hourBranch: body.hourBranch,
    datetime: body.datetime,
    timezone: body.timezone,
  };
  // Accept either bits (6 × 0/1, static) or yaoValues (6 × 6/7/8/9,
  // supports moving lines). The castSkill will throw a clear error
  // if neither is provided or if both are.
  if (!Array.isArray(input.bits) && !Array.isArray(input.yaoValues)) {
    throw new AppError('VALIDATION_ERROR',
      'either `bits` (6 × 0/1) or `yaoValues` (6 × 6/7/8/9) is required',
      HTTP_STATUS.BAD_REQUEST);
  }
  if (Array.isArray(input.bits) && Array.isArray(input.yaoValues)) {
    throw new AppError('VALIDATION_ERROR',
      'pass either `bits` OR `yaoValues`, not both',
      HTTP_STATUS.BAD_REQUEST);
  }
  const chart = assembleChart(input);
  const chartKey = body.chartKey || 'default';
  const stored = await saveChart(userId, sessionId, chart, chartKey);
  res.json({
    success: true,
    data: {
      ...chart,
      sessionId,
      chartKey,
      expiresAt: stored.expiresAt,
      _note: 'Stored in ChartStore (Mongo); the liuyao agent will read it on /chat.',
    },
  });
}));

// ─── GET /chart/keys/:sessionId ───────────────────────────────────────
router.get('/chart/keys/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const userId = userIdOrThrow(req);
  const keys = await listChartKeys(userId, req.params.sessionId);
  res.json({ success: true, data: { sessionId: req.params.sessionId, keys } });
}));

// ─── POST /analyze ───────────────────────────────────────────────────
router.post('/analyze', asyncHandler(async (req: Request, res: Response) => {
  const userId = userIdOrThrow(req);
  const body = req.body || {};
  const includeDebug = body.debug === true || body.debug === 'true';
  let chart = body.chart;

  // Resolve chart: inline → sessionId+chartKey (specific) → sessionId
  // (latest). All scoped by userId.
  if (!chart && body.sessionId) {
    let stored;
    try {
      stored = body.chartKey
        ? await getChart(userId, body.sessionId, body.chartKey)
        : await getLatestChart(userId, body.sessionId);
    } catch (err: any) {
      throw new AppError('CHART_NOT_FOUND', err.message, HTTP_STATUS.NOT_FOUND);
    }
    if (!stored) {
      throw new AppError('CHART_NOT_FOUND',
        `No stored chart for sessionId=${body.sessionId}`,
        HTTP_STATUS.NOT_FOUND);
    }
    chart = stored.chart;
  }

  if (!chart || typeof chart !== 'object') {
    throw new AppError('VALIDATION_ERROR',
      'Either a `chart` object or a `sessionId` (with stored chart) is required',
      HTTP_STATUS.BAD_REQUEST);
  }
  // runAnalysisAgent now runs the full multi-stage pipeline
  // (build brief → LLM #1 understand → RAG retrieve → LLM #2
  // synthesize). The result includes { report, brief, debug }.
  const result = await runAnalysisAgent(chart, userId, isAdmin(req), { debug: includeDebug });
  // Backward-compat: when the caller didn't ask for debug, return
  // just the report at the top level (the old shape).
  if (!includeDebug) {
    res.json({ success: true, data: result.report });
  } else {
    res.json({ success: true, data: result });
  }
}));

// ─── GET /brief/:sessionId ────────────────────────────────────────────
// Read the structured ChartBrief for the latest chart on the given
// session. The brief is the deterministic "understanding material"
// doc that gets fed to the LLM in the analyze pipeline. This
// endpoint lets a caller inspect it on its own without running the
// pipeline (or paying for the LLM calls).
router.get('/brief/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const userId = userIdOrThrow(req);
  const chartKey = (req.query.chartKey as string) || undefined;
  let stored;
  try {
    stored = chartKey
      ? await getChart(userId, req.params.sessionId, chartKey)
      : await getLatestChart(userId, req.params.sessionId);
  } catch (err: any) {
    throw new AppError('CHART_NOT_FOUND', err.message, HTTP_STATUS.NOT_FOUND);
  }
  if (!stored) {
    throw new AppError('CHART_NOT_FOUND',
      `No stored chart for sessionId=${req.params.sessionId}`,
      HTTP_STATUS.NOT_FOUND);
  }
  res.json({ success: true, data: buildChartBrief(stored.chart) });
}));

// ──────────────────────────────────────────────────────────────────────
// RAG endpoints (per-user)
// ──────────────────────────────────────────────────────────────────────

/** Bootstrap the system knowledge base. Admin only — walks the
 *  docs/base_knowledge/ directory and ingests each .md as a
 *  system-scope document. Idempotent. */
router.post('/rag/bootstrap', adminOnly, asyncHandler(async (_req: Request, res: Response) => {
  const r = await bootstrapSystemKnowledge();
  res.json({ success: true, data: r });
}));

/** Upload a markdown document. Defaults to user-scope (private to
 *  the caller). Admins can pass { scope: 'system' } to make a
 *  system-wide addition. */
router.post('/rag/upload', asyncHandler(async (req: Request, res: Response) => {
  const userId = userIdOrThrow(req);
  const body = req.body || {};
  const { filename, body: docBody, scope: requestedScope } = body;
  if (typeof filename !== 'string' || !filename.endsWith('.md')) {
    throw new AppError('VALIDATION_ERROR', 'filename must end in .md', HTTP_STATUS.BAD_REQUEST);
  }
  if (typeof docBody !== 'string' || !docBody.trim()) {
    throw new AppError('VALIDATION_ERROR', 'body is required (string)', HTTP_STATUS.BAD_REQUEST);
  }

  const isAdminUser = isAdmin(req);
  const scope = requestedScope === 'system' && isAdminUser ? 'system' : 'user';
  const ownerId = scope === 'system' ? null : userId;

  try {
    const r = await ingestDocument({
      scope,
      ownerId,
      filename,
      body: docBody,
      // Use the same active embedder (zhipu / hash) the bootstrap
      // used for system docs — otherwise user-scope chunks end up
      // 64-dim (hash) while system chunks are 2048-dim (zhipu),
      // and the search-time cosine similarity becomes meaningless.
      embedder: resolveEmbedder(),
    });
    res.json({ success: true, data: { ...r, scope, ownerId } });
  } catch (err: any) {
    throw new AppError('INGEST_FAILED', err.message, HTTP_STATUS.BAD_REQUEST);
  }
}));

router.get('/rag/list', asyncHandler(async (req: Request, res: Response) => {
  const userId = userIdOrThrow(req);
  const admin = isAdmin(req);
  res.json({ success: true, data: await ragStats(userId, admin) });
}));

router.post('/rag/search', asyncHandler(async (req: Request, res: Response) => {
  const userId = userIdOrThrow(req);
  const admin = isAdmin(req);
  const { query, k } = req.body || {};
  if (typeof query !== 'string' || !query) {
    throw new AppError('VALIDATION_ERROR', 'query is required', HTTP_STATUS.BAD_REQUEST);
  }
  const top = await search(query, typeof k === 'number' ? k : 4, userId, admin);
  res.json({
    success: true,
    data: top.map(({ chunk, score }) => ({
      source: chunk.source,
      title: chunk.title,
      scope: chunk.scope,
      snippet: chunk.text.slice(0, 200),
      score,
    })),
  });
}));

router.delete('/rag/:source(*)', asyncHandler(async (req: Request, res: Response) => {
  const userId = userIdOrThrow(req);
  const admin = isAdmin(req);
  const source = req.params.source;
  const r = await deleteDocument(userId, source, admin);
  if (!r.deleted) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({
      success: false,
      error: { code: 'DOC_NOT_FOUND', message: `No document matching ${source} (or not yours)` },
    });
  }
  res.json({ success: true, data: { deleted: true, source: r.source } });
}));

export default router;
