/**
 * /api/v1/divination/* — the public HTTP surface for the 六爻 engine.
 *
 * Routes:
 *   POST /cast       — run the casting skill (6 raw bits → CastResult)
 *   POST /chart      — run the full chart assembler (raw bits + day
 *                      pillar + question → ChartResult + warnings)
 *   POST /analyze    — run the analysis agent on a ChartResult
 *   GET  /rag/stats  — show the RAG index
 *   POST /rag/search — search the RAG index
 *   POST /rag/rebuild — rebuild the RAG index (after editing
 *                       docs/base_knowledge/*.md)
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
  res.json({ success: true, data: chart });
}));

// ─── POST /analyze ───────────────────────────────────────────────────
router.post('/analyze', asyncHandler(async (req: Request, res: Response) => {
  const chart = req.body?.chart;
  if (!chart || typeof chart !== 'object') {
    throw new AppError('VALIDATION_ERROR', 'chart object is required in the request body', HTTP_STATUS.BAD_REQUEST);
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
      text: chunk.text,
      score,
    })),
  });
}));

router.post('/rag/rebuild', asyncHandler(async (_req: Request, res: Response) => {
  await buildIndex();
  res.json({ success: true, data: await ragStats() });
}));

export default router;
