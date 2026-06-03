/**
 * /api/v1/divination/* — the public HTTP surface for the 六爻 engine.
 *
 * Routes:
 *   POST /cast                  — 6 raw bits → CastResult
 *   POST /chart                 — full chart; also PERSISTS to ChartStore
 *                                 under sessionId so the agent can
 *                                 read it later. sessionId is REQUIRED.
 *   POST /analyze               — accepts either {chart: ...} inline
 *                                 OR {sessionId} to pull from the store
 *                                 (the latter is what the agent uses)
 *   GET  /chart/keys/:sessionId — list stored chart keys for a session
 *   GET  /rag/stats             — RAG index size
 *   POST /rag/search            — top-k chunks for a query
 *   POST /rag/rebuild           — rebuild the RAG index
 *
 * The chart assembler records a `warnings[]` array on the response so
 * the caller can see exactly which skills threw `TodoError`s (i.e.
 * which tables in KNOWLEDGE_NEEDED.md still need to be filled in).
 */
import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { authMiddleware } from '../middleware/auth';
import { castSkill } from '../liuyao/skills/castSkill';
import { assembleChart, type AssembleInput } from '../liuyao/skills/chartAssembler';
import { runAnalysisAgent } from '../liuyao/agent/analysisAgent';
import { search, ragStats, buildIndex } from '../liuyao/rag/index';
import { saveChart, getChart, listChartKeys } from '../core/memory/ChartStore';
import { HTTP_STATUS } from '../constants';

const router = Router();

router.use(authMiddleware(true));

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
  const body = req.body || {};
  const sessionId: string | undefined = body.sessionId;
  if (!sessionId) {
    throw new AppError('VALIDATION_ERROR',
      'sessionId is required — the chart is persisted under it so the liuyao agent can read it later',
      HTTP_STATUS.BAD_REQUEST);
  }
  const input: AssembleInput = {
    question: body.question,
    questionType: body.questionType,
    bits: body.bits,
    dayStem: body.dayStem,
    dayBranch: body.dayBranch,
    monthBranch: body.monthBranch,
    datetime: body.datetime,
    timezone: body.timezone,
  };
  if (!Array.isArray(input.bits) || input.bits.length !== 6) {
    throw new AppError('VALIDATION_ERROR', 'bits must be an array of 6 entries (0 or 1)', HTTP_STATUS.BAD_REQUEST);
  }
  const chart = assembleChart(input);
  const chartKey = body.chartKey || 'default';
  await saveChart(sessionId, chart, chartKey);
  res.json({
    success: true,
    data: { ...chart, sessionId, chartKey, _note: 'Stored in ChartStore; agent will read from here.' },
  });
}));

// ─── GET /chart/keys/:sessionId ───────────────────────────────────────
router.get('/chart/keys/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const keys = await listChartKeys(req.params.sessionId);
  res.json({ success: true, data: { sessionId: req.params.sessionId, keys } });
}));

// ─── POST /analyze ───────────────────────────────────────────────────
router.post('/analyze', asyncHandler(async (req: Request, res: Response) => {
  // Two modes: pass a chart directly, OR pass sessionId (+ optional
  // chartKey) to pull from ChartStore. The agent uses the latter.
  const body = req.body || {};
  let chart = body.chart;
  if (!chart && body.sessionId) {
    const stored = await getChart(body.sessionId, body.chartKey);
    if (!stored) {
      throw new AppError('CHART_NOT_FOUND',
        `No stored chart for sessionId=${body.sessionId}` +
        (body.chartKey ? ` key=${body.chartKey}` : '') +
        '. Run /divination/chart first.',
        HTTP_STATUS.NOT_FOUND);
    }
    chart = stored.chart;
  }
  if (!chart || typeof chart !== 'object') {
    throw new AppError('VALIDATION_ERROR',
      'Either a `chart` object or a `sessionId` (with stored chart) is required',
      HTTP_STATUS.BAD_REQUEST);
  }
  const report = await runAnalysisAgent(chart);
  res.json({ success: true, data: report });
}));

// ─── RAG endpoints ───────────────────────────────────────────────────
router.get('/rag/stats', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: await ragStats() });
}));

router.post('/rag/search', asyncHandler(async (req: Request, res: Response) => {
  const { query, k } = req.body || {};
  if (typeof query !== 'string' || !query) {
    throw new AppError('VALIDATION_ERROR', 'query is required', HTTP_STATUS.BAD_REQUEST);
  }
  const top = await search(query, typeof k === 'number' ? k : 4);
  res.json({
    success: true,
    data: top.map(({ chunk, score }) => ({
      source: chunk.source,
      title: chunk.title,
      snippet: chunk.text.slice(0, 200),
      score,
    })),
  });
}));

router.post('/rag/rebuild', asyncHandler(async (_req: Request, res: Response) => {
  await buildIndex();
  res.json({ success: true, data: await ragStats() });
}));

export default router;
