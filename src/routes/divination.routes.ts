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
 *   POST /cast                  — structured casting methods or 6 raw
 *                                 bits → normalized yaoValues/CastResult
 *   POST /chart                 — full chart; also PERSISTS to ChartStore
 *                                 under (userId, sessionId, chartKey)
 *   POST /ask                   — complete flow: chart + store + default
 *                                 六爻 RAG analysis + chat-memory turn
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
import { resolveCasting, type CastingResult } from '../liuyao/casting/methods';
import { runAnalysisAgent } from '../liuyao/agent/analysisAgent';
import { buildChartBrief } from '../liuyao/agent/chartBrief';
import type { AnalysisReport } from '../liuyao/types/agent';
import {
  search, ragStats, ingestDocument, deleteDocument, bootstrapSystemKnowledge,
  resolveEmbedder,
} from '../liuyao/rag/index';
import {
  saveChart, getChart, listChartKeys, getLatestChart,
} from '../core/memory/ChartStore';
import { getTemporaryMemory } from '../core/memory/TemporaryMemory';
import { getPermanentMemory } from '../core/memory/PermanentMemory';
import { getAgent } from '../core/agents/AgentLoader';
import { getLLMManager } from '../core/llm/LLMFactory';
import type { LLMMessage } from '../core/llm/types';
import { HTTP_STATUS } from '../constants';
import { logger } from '../utils/logger';
import { generateSessionId } from '../utils/helpers';

const router = Router();
const DEFAULT_DIVINATION_CHAT_PROMPT = '请结合卦象分析、解答问题';
const DEFAULT_INTERACTIVE_SUMMARY_PROMPT = [
  '你是 Roy，一个六爻交互式 CLI Agent。',
  '请把完整解卦报告压缩成适合命令行对话的短答。',
  '要求：',
  '1. 必须使用用户问题的语言。',
  '2. 先给一句明确结论，格式为“结论：...”。',
  '3. 给 3 条以内关键依据，每条 1-2 句。',
  '4. 不要输出 RAG、LLM、pipeline、debug、JSON、Markdown、文件路径、provider、token 等工程术语。',
  '5. 不要编造排盘；只能基于输入的排盘摘要和完整报告。',
  '6. 不要输出完整长报告；完整报告由 /why 展开。',
].join('\n');

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

function normalizeSessionId(sessionId: unknown): string {
  if (typeof sessionId !== 'string' || !sessionId.trim()) return generateSessionId();
  return sessionId.trim().replace(/\s+/g, '_');
}

function buildAssembleInput(body: any, casting: CastingResult | null = resolveCastingForBody(body)): AssembleInput {
  return {
    question: body.question,
    questionType: body.questionType,
    bits: casting ? undefined : body.bits,
    yaoValues: casting ? casting.yaoValues : body.yaoValues,
    dayStem: body.dayStem,
    dayBranch: body.dayBranch,
    monthBranch: body.monthBranch,
    hourStem: body.hourStem,
    hourBranch: body.hourBranch,
    datetime: body.datetime,
    timezone: body.timezone,
  };
}

function resolveCastingForBody(body: any): CastingResult | null {
  if (!body || typeof body !== 'object') return null;
  const nested = body.casting && typeof body.casting === 'object' ? body.casting : {};
  const method = nested.method ?? body.castMethod ?? body.method ??
    (nested.coins != null || body.coins != null ? 'coins' : undefined) ??
    (nested.numbers != null || body.numbers != null ? 'numbers' : undefined) ??
    (nested.character != null || body.character != null || nested.text != null || body.text != null ? 'character' : undefined);
  const hasStructuredInput = method != null ||
    body.coins != null || body.numbers != null || body.character != null || body.text != null ||
    nested.coins != null || nested.numbers != null || nested.character != null || nested.text != null;
  if (!hasStructuredInput) return null;
  try {
    return resolveCasting({
      method,
      bits: nested.bits ?? body.bits,
      yaoValues: nested.yaoValues ?? body.yaoValues,
      coins: nested.coins ?? body.coins,
      numbers: nested.numbers ?? body.numbers,
      character: nested.character ?? body.character,
      text: nested.text ?? body.text,
      datetime: nested.datetime ?? body.datetime,
      timezone: nested.timezone ?? body.timezone,
    });
  } catch (err: any) {
    throw new AppError('VALIDATION_ERROR', err.message ?? String(err), HTTP_STATUS.BAD_REQUEST);
  }
}

function validateCastInput(input: AssembleInput): void {
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
}

function buildSummaryMessages(body: any): LLMMessage[] {
  const chart = body.chart || {};
  const t = chart.time || {};
  const lines = Array.isArray(chart.lines) ? chart.lines : [];
  const shi = lines.find((l: any) => l.isShi);
  const ying = lines.find((l: any) => l.isYing);
  const chartSummary = [
    body.question ? `用户问题：${body.question}` : null,
    `本卦：${chart.originalHexagram?.fullName || chart.originalHexagram?.name || '?'}`,
    `变卦：${chart.changedHexagram?.fullName || chart.changedHexagram?.name || '?'}`,
    `卦宫：${chart.originalHexagram?.palace || '?'}宫 · ${chart.originalHexagram?.palaceType || '?'} · ${chart.originalHexagram?.element || '?'}`,
    `动爻：${(chart.movingLines || []).join('、') || '无'}`,
    shi ? `世爻：第${shi.position}爻 ${shi.stem || ''}${shi.branch || ''}(${shi.element || '?'}) ${shi.sixRelative || ''} 临${shi.sixGod || ''}${shi.void ? ' 旬空' : ''}` : null,
    ying ? `应爻：第${ying.position}爻 ${ying.stem || ''}${ying.branch || ''}(${ying.element || '?'}) ${ying.sixRelative || ''} 临${ying.sixGod || ''}${ying.void ? ' 旬空' : ''}` : null,
    t.yearStem ? `时间：${t.yearStem}${t.yearBranch}年 / ${t.monthStem}${t.monthBranch}月 / ${t.dayStem}${t.dayBranch}日 / ${t.hourStem}${t.hourBranch}时` : null,
  ].filter(Boolean).join('\n');

  const report = formatCitationDisplay(String(body.content || body.reportText || ''), {
    showCitations: false,
  }).slice(0, 12000);
  return [
    { role: 'system', content: DEFAULT_INTERACTIVE_SUMMARY_PROMPT },
    {
      role: 'user',
      content: [
        '【排盘摘要】',
        chartSummary,
        '',
        '【完整解卦报告】',
        report,
        '',
        '请输出交互式短答。',
      ].join('\n'),
    },
  ];
}

function parseAnalysisOptions(body: any): { debug: boolean; thinking: boolean; angles: number } {
  const debug = body.debug === true || body.debug === 'true';
  const thinking = body.thinking === true || body.thinking === 'true';
  const rawAngles = Number(body.angles);
  const angles = Number.isFinite(rawAngles)
    ? Math.max(1, Math.min(5, Math.floor(rawAngles)))
    : 3;
  return { debug, thinking, angles };
}

function renderAnalysisReport(report: AnalysisReport, options: { showCitations: boolean }): string {
  if (
    looksLikeCompleteMarkdownReport(report.synthesis) &&
    (!report.summary || report.summary.includes('未生成概要段'))
  ) {
    return appendReportExtras(report.synthesis.trim(), report, options);
  }

  const sections: Array<[keyof AnalysisReport, string]> = [
    ['summary', '一、卦象概要'],
    ['originalHexagramInterpretation', '二、本卦解释'],
    ['changedHexagramInterpretation', '三、变卦解释'],
    ['movingLineAnalysis', '四、动爻分析'],
    ['shiYingAnalysis', '五、世应关系'],
    ['yongshenAnalysis', '六、用神分析'],
    ['strengthAndRelations', '七、旺衰、空破与冲合'],
    ['synthesis', '八、综合判断'],
  ];
  const out: string[] = [];
  for (const [key, label] of sections) {
    const value = report[key];
    if (typeof value === 'string' && value.trim()) {
      out.push(`## ${label}\n\n${formatCitationDisplay(value.trim(), options)}`);
    }
  }
  if (report.uncertainties?.length) {
    out.push(`## 九、不确定性与需要补充的信息\n\n${report.uncertainties.map((u) => `- ${u}`).join('\n')}`);
  }
  if (options.showCitations && report.citations?.length) {
    out.push(`## 引用\n\n${report.citations.map((c) => `- ${c.source} (${c.score.toFixed(3)}): ${c.snippet}`).join('\n')}`);
  }
  return formatCitationDisplay(out.join('\n\n').trim(), options);
}

function looksLikeCompleteMarkdownReport(value: string | undefined): boolean {
  if (!value) return false;
  return value.includes('综合分析报告') ||
    value.includes('### ①') ||
    value.includes('#### ①') ||
    value.includes('分析角度：');
}

function appendReportExtras(markdown: string, report: AnalysisReport, options: { showCitations: boolean }): string {
  const out = [formatCitationDisplay(markdown, options)];
  if (report.uncertainties?.length && !markdown.includes('不确定性')) {
    out.push(`## 不确定性与需要补充的信息\n\n${report.uncertainties.map((u) => `- ${u}`).join('\n')}`);
  }
  if (options.showCitations && report.citations?.length && !markdown.includes('## 引用')) {
    out.push(`## 引用\n\n${report.citations.map((c) => `- ${c.source} (${c.score.toFixed(3)}): ${c.snippet}`).join('\n')}`);
  }
  return out.join('\n\n').trim();
}

function formatCitationDisplay(markdown: string, options: { showCitations: boolean }): string {
  if (options.showCitations) return markdown;
  return markdown
    .replace(/\s*\[cite:[^\]]+\]/g, '')
    .replace(/\n{0,2}#{1,6}\s*引用[\s\S]*$/m, '')
    .trim();
}

// ─── POST /cast ───────────────────────────────────────────────────────
router.post('/cast', asyncHandler(async (req: Request, res: Response) => {
  const body = req.body || {};
  const casting = resolveCastingForBody(body);
  if (casting) {
    const cast = castSkill({ yaoValues: casting.yaoValues });
    res.json({ success: true, data: { ...casting, cast } });
    return;
  }
  const { bits, interpretation } = body;
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
  const casting = resolveCastingForBody(body);
  const input = buildAssembleInput(body, casting);
  // Accept either bits (6 × 0/1, static) or yaoValues (6 × 6/7/8/9,
  // supports moving lines). The castSkill will throw a clear error
  // if neither is provided or if both are.
  validateCastInput(input);
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
      casting,
      _note: 'Stored in ChartStore (Mongo); the liuyao agent will read it on /chat.',
    },
  });
}));

// ─── POST /ask ────────────────────────────────────────────────────────
// One-shot full flow:
//   起卦输入 → assembleChart → saveChart → runAnalysisAgent (same RAG
//   pipeline used by divination.analyze/tool) → persist a chat-like
//   user/assistant pair in temporary memory for later `orbit chat --session`.
router.post('/ask', asyncHandler(async (req: Request, res: Response) => {
  const userId = userIdOrThrow(req);
  const body = req.body || {};
  const sessionId = normalizeSessionId(body.sessionId);
  const chartKey = body.chartKey || 'default';
  const message = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim()
    : DEFAULT_DIVINATION_CHAT_PROMPT;
  const { debug, thinking, angles } = parseAnalysisOptions(body);
  const casting = resolveCastingForBody(body);
  const input = buildAssembleInput(body, casting);
  validateCastInput(input);

  const chart = assembleChart(input);
  const stored = await saveChart(userId, sessionId, chart, chartKey);
  const agent = getAgent(body.agentId || 'default');
  const analysis = await runAnalysisAgent(chart, userId, isAdmin(req), {
    model: body.model || agent?.model,
    debug,
    thinking,
    angles,
  });
  const content = renderAnalysisReport(analysis.report, { showCitations: debug });

  // Store this as a normal chat turn so the caller can immediately
  // continue with `orbit chat --session <id> ...`.
  const tempMemory = getTemporaryMemory();
  const permanentMemory = getPermanentMemory();
  await tempMemory.addMessage(sessionId, {
    userId,
    sessionId,
    role: 'user',
    content: message,
    modelId: body.model || agent?.model,
    modelProvider: body.provider || agent?.provider,
  });
  await tempMemory.addMessage(sessionId, {
    userId,
    sessionId,
    role: 'assistant',
    content,
    modelId: analysis.debug?.synthesis?.model || body.model || agent?.model,
    modelProvider: analysis.debug?.synthesis?.provider || body.provider || agent?.provider,
  });
  const conversation = await permanentMemory.getConversationBySessionId(sessionId, userId) ??
    await permanentMemory.createConversation({
      userId,
      sessionId,
      agentId: agent?.id || body.agentId || 'default',
      modelId: body.model || agent?.model || analysis.debug?.synthesis?.model || 'unknown',
      modelProvider: body.provider || agent?.provider || analysis.debug?.synthesis?.provider || 'unknown',
      title: (body.question || message || '六爻起卦').slice(0, 60),
      tags: ['liuyao', 'divination'],
      isArchived: false,
    });
  await Promise.all([
    permanentMemory.addMessage(conversation.id, {
      role: 'user',
      content: message,
      modelId: body.model || agent?.model,
      modelProvider: body.provider || agent?.provider,
      metadata: {
        question: body.question,
        chartKey,
        casting,
      },
    }),
    permanentMemory.addMessage(conversation.id, {
      role: 'assistant',
      content,
      modelId: analysis.debug?.synthesis?.model || body.model || agent?.model,
      modelProvider: analysis.debug?.synthesis?.provider || body.provider || agent?.provider,
      metadata: {
        chartKey,
        chart,
        report: analysis.report,
        content,
      },
    }),
  ]);

  res.json({
    success: true,
    data: {
      sessionId,
      chartKey,
      expiresAt: stored.expiresAt,
      message,
      agentId: agent?.id || body.agentId || 'default',
      thinking,
      angles: thinking ? angles : undefined,
      content,
      casting,
      chart,
      report: analysis.report,
      brief: analysis.brief,
      debug: debug ? analysis.debug : undefined,
      _note: 'Full flow completed: chart stored, RAG analysis generated, and a chat turn was added to temporary memory.',
    },
  });
}));

// ─── POST /summarize ─────────────────────────────────────────────────
// LLM-produced short answer for the interactive CLI. This is intentionally
// separate from /ask so the full report remains available for /why while
// the default conversation stays compact.
router.post('/summarize', asyncHandler(async (req: Request, res: Response) => {
  userIdOrThrow(req);
  const body = req.body || {};
  if (!body.content && !body.reportText) {
    throw new AppError('VALIDATION_ERROR', 'content or reportText is required', HTTP_STATUS.BAD_REQUEST);
  }

  const agent = getAgent(body.agentId || 'default');
  const llm = getLLMManager();
  const response = await llm.chat(buildSummaryMessages(body), {
    model: body.model || agent?.model,
    temperature: 0.2,
    maxTokens: 700,
  });

  res.json({
    success: true,
    data: {
      content: response.content,
      model: response.model,
      provider: response.provider,
      usage: response.usage,
    },
  });
}));

router.post('/summarize/stream', async (req: Request, res: Response) => {
  try {
    userIdOrThrow(req);
    const body = req.body || {};
    if (!body.content && !body.reportText) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'content or reportText is required' },
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const agent = getAgent(body.agentId || 'default');
    const llm = getLLMManager();
    let fullContent = '';
    for await (const chunk of llm.streamChat(buildSummaryMessages(body), {
      model: body.model || agent?.model,
      temperature: 0.2,
      maxTokens: 700,
    })) {
      if (chunk.type === 'content' && chunk.content) {
        fullContent += chunk.content;
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
      } else if (chunk.type === 'done') {
        res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent, usage: chunk.usage })}\n\n`);
      } else if (chunk.type === 'error') {
        res.write(`data: ${JSON.stringify({ type: 'error', error: chunk.error })}\n\n`);
      }
    }
  } catch (error) {
    logger.error('[Divination summarize stream] error:', error);
    if (!res.headersSent) {
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Summarize stream failed',
        },
      });
    } else {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: error instanceof Error ? error.message : 'Summarize stream failed',
      })}\n\n`);
    }
  } finally {
    res.end();
  }
});

// ─── GET /chart/keys/:sessionId ───────────────────────────────────────
router.get('/chart/keys/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const userId = userIdOrThrow(req);
  const keys = await listChartKeys(userId, req.params.sessionId);
  res.json({ success: true, data: { sessionId: req.params.sessionId, keys } });
}));

// ─── GET /reading/:sessionId ─────────────────────────────────────────
// Restore the cast artifact for an existing conversation. The chart is
// loaded from ChartStore when available, with a metadata snapshot fallback
// for older conversations or charts that outlive the temporary chart TTL.
router.get('/reading/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const userId = userIdOrThrow(req);
  const permanentMemory = getPermanentMemory();
  const conversation = await permanentMemory.getConversationBySessionId(req.params.sessionId, userId);

  if (!conversation) {
    throw new AppError('READING_NOT_FOUND', 'No divination reading for this session', HTTP_STATUS.NOT_FOUND);
  }

  const messages = await permanentMemory.getMessages(conversation.id, { pageSize: 200 });
  const assistant = [...messages].reverse().find((message) =>
    message.role === 'assistant' &&
    (message.metadata?.report || message.metadata?.chartKey || message.metadata?.chart)
  );
  const userMessage = messages.find((message) => message.role === 'user');
  const chartKey = assistant?.metadata?.chartKey || userMessage?.metadata?.chartKey || 'default';

  let storedChart = null;
  try {
    storedChart = await getLatestChart(userId, req.params.sessionId);
  } catch {
    storedChart = null;
  }
  const chart = storedChart?.chart || assistant?.metadata?.chart;
  if (!chart) {
    throw new AppError('READING_NOT_FOUND', 'No chart snapshot for this session', HTTP_STATUS.NOT_FOUND);
  }

  res.json({
    success: true,
    data: {
      sessionId: req.params.sessionId,
      chartKey,
      message: userMessage?.content,
      content: assistant?.metadata?.content || assistant?.content || '',
      casting: userMessage?.metadata?.casting,
      chart,
      report: assistant?.metadata?.report,
    },
  });
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
  // Thinking-mode opt-in. `thinking: true` switches the pipeline from
  // 3-stage (1 RAG pass + 1 final synthesis) to multi-angle (1 + N + 1
  // LLM calls, each angle doing its own RAG pass). Clamp `angles` to
  // [1, 5] with a default of 3.
  const thinking = body.thinking === true || body.thinking === 'true';
  const rawAngles = Number(body.angles);
  const angleBudget = Number.isFinite(rawAngles)
    ? Math.max(1, Math.min(5, Math.floor(rawAngles)))
    : 3;
  // runAnalysisAgent now runs either the default 3-stage pipeline or
  // the multi-angle thinking pipeline. The result is
  // { report, brief, debug } either way.
  const result = await runAnalysisAgent(chart, userId, isAdmin(req), {
    debug: includeDebug,
    thinking,
    angles: angleBudget,
  });
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
const rebuildSystemKnowledge = asyncHandler(async (_req: Request, res: Response) => {
  const r = await bootstrapSystemKnowledge();
  res.json({ success: true, data: r });
});

router.post('/rag/bootstrap', adminOnly, rebuildSystemKnowledge);
router.post('/rag/rebuild', adminOnly, rebuildSystemKnowledge);

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
