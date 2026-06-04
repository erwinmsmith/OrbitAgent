/**
 * Analysis agent — multi-stage pipeline that produces the final
 * AnalysisReport from a stored ChartResult.
 *
 * Stages (all visible via the `debug` field on the result):
 *
 *   Stage 0 (no LLM)   buildChartBrief(chart) → structured
 *                       "understanding material" doc. Pure function;
 *                       deterministic; same on every run.
 *
 *   Stage 1 (LLM #1)   Understand. Brief + user question + system
 *                       prompt → the LLM (a) refines the question
 *                       type, (b) picks the 用神 to focus on,
 *                       (c) proposes 2-3 RAG queries, (d) writes a
 *                       short intermediate "understanding" prose.
 *                       The LLM may also call `divination.rag-search`
 *                       directly via tool calling, but the canonical
 *                       path is for it to return a JSON plan.
 *
 *   Stage 2 (RAG)      Run the union of (LLM-proposed queries +
 *                       a few auto-derived queries like the hexagram
 *                       name + 用神 relatives) through the RAG index,
 *                       dedupe, take top-k.
 *
 *   Stage 3 (LLM #2)   Synthesize. Brief + Stage 1 understanding +
 *                       RAG hits → the final 6/9-section prose
 *                       report with `[cite: source]` markers. The
 *                       synthesizer is told to use the citations
 *                       already provided; it may NOT invent them.
 *
 * The whole thing returns a structured `AnalysisResult` (not just
 * prose) so the chat route can surface the timeline to the caller
 * via `debug.pipeline`.
 *
 * Faithful to design.md: the LLM is forbidden from recomputing any
 * chart field. If a field is missing it must say so. We also never
 * expose raw userId/sessionId to the LLM.
 */
import type { AnalysisReport, RagCitation } from '../types/agent';
import type { ChartResult } from '../types/chart';
import { buildChartBrief, type ChartBrief } from './chartBrief';
import {
  searchMany,
  dedupeManyHits,
  search as ragSearch,
  type RagChunk,
} from '../rag';
import { getLLMManager } from '../../core/llm/LLMFactory';
import { logger } from '../../utils/logger';

const STEP_UNDERSTAND_SYSTEM = `你是六爻分析 Agent 的"理解阶段"。
你的输入是已经排好的 ChartBrief（六爻结构化信息），以及用户的原始问题。
你的任务：
1. 阅读 ChartBrief，理解本卦/变卦/动爻/世应/用神/排盘警告。
2. 指出对回答用户问题最关键的信息（用神、五行、旺衰、动爻化出、旬空等）。
3. 决定需要从六爻知识库里召回哪些信息来支撑你的理解 — 给出 2-4 个 RAG 查询。
4. 写一段简短的"中间理解"（200-400 字），说明你打算从哪些角度分析。

严格规则：
- 不能重新排盘或修改 ChartBrief 中的任何字段。
- 不能下"吉/凶"绝对断言 — 你只是在为下一阶段的"综合分析"提供材料。
- RAG 查询必须是六爻知识库里可能存在的概念，例如：
  "妻财持世 求财"、"回头生克"、"用神旺衰"、"动化进退"、"六爻 事业"、
  "六爻 感情"、"六爻 考试"、"六爻 失物"、"六爻 出行"、"六爻 合同"、
  "六爻 健康"、"伏神"、"飞神"、"世爻 应爻"、"卦宫五行"、"六神"等。
- 不需要查的内容不要查；查询要精炼，2-4 个最佳。

返回严格的 JSON（不要包裹在 markdown 代码块中）：
{
  "refinedQuestionType": "求财" | "求事业" | "求感情" | "求考试" | "求合同" | "求健康" | "求失物" | "求出行" | "求合作" | "求官司" | "求宠物" | "其他",
  "focusYongshen": ["妻财", "官鬼", ...],   // 你认为对回答用户问题最关键的一个或多个六亲
  "ragQueries": ["查询1", "查询2", "查询3"],
  "intermediateUnderstanding": "200-400 字的中间理解，指出关键爻位、动爻化出、用神、需要注意的冲合/旬空/动变等。"
}`;

const STEP_SYNTHESIZE_SYSTEM = `你是六爻分析 Agent 的"综合分析阶段"。
你的输入是：
- ChartBrief（已经排好的结构化信息，**不要重新排盘**）
- 上一阶段（理解阶段）的中间理解
- 从六爻知识库召回的相关片段（每条带 [cite: source] 标签）
- 用户的原始问题

你的任务是写一份 6-9 段的综合分析报告（中文），要求：
1. 严格基于 ChartBrief 中的结构化信息 — 不能改写本卦/变卦/六亲/六神/世应/纳甲/旬空/旺衰/用神候选。
2. 引用召回片段时，**必须**保留 [cite: source] 标签，例如：
   "妻财持世，求财可得 [cite: docs/base_knowledge/六爻用神.md]"。
   没有引用就**不要**编造 [cite: ...] 标签。
3. 不能下"一定成/一定不成"的绝对断言 — 给出"倾向于 / 有利于 / 不利于 / 需注意"的谨慎判断。
4. 报告结构（6 段 MVP，可扩展到 9 段）：
   ① 卦象概要：简述本卦/变卦/动爻/世应
   ② 本卦解释：本卦的卦象含义（结合卦辞、卦理、卦宫五行）
   ③ 动爻分析：动爻的爻辞含义、动爻化出、与日辰月令的关系
   ④ 用神分析：用神候选的旺衰、与日辰/世应/动爻的生克
   ⑤ 世应关系：世爻与应爻的五行生克
   ⑥ 综合判断：结合以上各段，给出对用户问题的倾向性判断和需要补充的信息
5. 最后必须列一个"不确定性与缺失信息"段落，列出：
   - 排盘中 warns 的内容
   - 理解阶段 missingContext 的内容
   - 你自身不能从 ChartBrief 推出的信息

输出 Markdown，不要包裹在 JSON 里。`;

export interface PipelineStepDebug {
  /** Stage id: "build-brief" | "understand" | "rag-retrieve" | "synthesize". */
  stage: 'build-brief' | 'understand' | 'rag-retrieve' | 'synthesize';
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Free-form per-stage metadata (model, token usage, query list, ...). */
  meta: Record<string, unknown>;
}

export interface AnalysisDebug {
  /** Total wall-clock for the whole pipeline. */
  totalDurationMs: number;
  /** Per-stage breakdown. */
  pipeline: PipelineStepDebug[];
  /** The brief rendered as markdown (Stage 0 output). */
  brief: ChartBrief;
  /** Stage 1 LLM call: refined type, focus, queries, intermediate prose. */
  understanding: {
    refinedQuestionType: string;
    focusYongshen: string[];
    ragQueries: string[];
    intermediateUnderstanding: string;
    model: string;
    provider: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number; cacheHitTokens?: number };
  };
  /** Stage 2 RAG: every query that was run, the hits they returned, and the deduped top-k. */
  rag: {
    queries: string[];
    perQueryHits: Array<{ query: string; hitCount: number; topScore: number }>;
    deduped: Array<{
      source: string;
      title: string;
      score: number;
      provenanceQueries: string[];
      snippet: string;
    }>;
  };
  /** Stage 3 LLM call: model + usage. */
  synthesis: {
    model: string;
    provider: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number; cacheHitTokens?: number };
  };
}

export interface AnalysisResult {
  /** The final user-facing report (markdown prose). */
  report: AnalysisReport;
  /** The structured brief that was built from the chart. */
  brief: ChartBrief;
  /** Full debug timeline (only populated when `options.debug` is true). */
  debug: AnalysisDebug;
}

/** Run the multi-stage analysis pipeline on a stored chart. */
export async function runAnalysisAgent(
  chart: ChartResult,
  requesterId: string,
  isAdmin: boolean = false,
  options: {
    /** Model id to use for both LLM calls. Defaults to the LLM
     *  manager's default model. */
    model?: string;
    /** When true, every stage's timing/metadata is preserved in
     *  `result.debug` for the caller to inspect. */
    debug?: boolean;
  } = {},
): Promise<AnalysisResult> {
  const totalStart = Date.now();
  const pipeline: PipelineStepDebug[] = [];

  // ─── Stage 0: build the brief ──────────────────────────────────
  const t0 = Date.now();
  const brief = buildChartBrief(chart);
  const buildMs = Date.now() - t0;
  pipeline.push({ stage: 'build-brief', durationMs: buildMs, meta: { lineCount: brief.lines.length } });

  const llm = getLLMManager();
  const modelId = options.model || llm.getDefaultModel();

  // ─── Stage 1: LLM #1 — understand ──────────────────────────────
  const t1 = Date.now();
  const understandMessages = [
    { role: 'system' as const, content: STEP_UNDERSTAND_SYSTEM },
    { role: 'user' as const, content:
      `【用户问题】\n${brief.question || '(用户没有明确问题，请基于卦象给出通用分析)'}\n\n` +
      `【ChartBrief】\n${brief.asMarkdown}\n\n` +
      `请按要求返回 JSON。` },
  ];
  let understandResp;
  try {
    understandResp = await llm.chat(understandMessages, { model: modelId, temperature: 0.3, maxTokens: 2048 });
  } catch (e: any) {
    // If the LLM call fails (e.g. provider down), we still want to
    // return a structured response — fall through with an empty
    // understanding and let the synthesizer work from the brief alone.
    logger.warn(`runAnalysisAgent: understand LLM call failed (${e?.message ?? e}); using fallback understanding`);
    understandResp = {
      id: 'fallback',
      model: modelId,
      provider: 'unknown' as any,
      content: '',
      role: 'assistant' as const,
      finishReason: 'stop' as const,
    };
  }
  const understandMs = Date.now() - t1;
  const parsedUnderstand = parseUnderstandResponse(understandResp.content || '');
  pipeline.push({
    stage: 'understand',
    durationMs: understandMs,
    meta: {
      model: understandResp.model,
      provider: understandResp.provider,
      usage: understandResp.usage,
      refinedQuestionType: parsedUnderstand.refinedQuestionType,
      focusYongshen: parsedUnderstand.focusYongshen,
      ragQueries: parsedUnderstand.ragQueries,
      rawContentLength: (understandResp.content || '').length,
    },
  });

  // ─── Stage 2: RAG retrieval ───────────────────────────────────
  const t2 = Date.now();
  // Union the LLM-proposed queries with a few auto-queries so the
  // retrieval still produces useful hits when the LLM proposes
  // nothing (e.g. provider down → fallback).
  const autoQueries: string[] = [];
  if (brief.originalHexagram.name) autoQueries.push(brief.originalHexagram.name);
  if (brief.questionType) autoQueries.push(`六爻 ${brief.questionType}`);
  for (const ys of parsedUnderstand.focusYongshen) autoQueries.push(ys);
  const allQueries = Array.from(new Set([...parsedUnderstand.ragQueries, ...autoQueries]))
    .map((q) => q.trim())
    .filter(Boolean);

  let perQueryResults: Array<{ query: string; hits: Array<{ chunk: RagChunk; score: number }> }> = [];
  if (allQueries.length > 0) {
    perQueryResults = await searchMany(allQueries, 4, requesterId, isAdmin);
  }
  const deduped = dedupeManyHits(perQueryResults, 8);
  const ragMs = Date.now() - t2;
  pipeline.push({
    stage: 'rag-retrieve',
    durationMs: ragMs,
    meta: {
      queryCount: allQueries.length,
      totalHitCount: perQueryResults.reduce((s, r) => s + r.hits.length, 0),
      dedupedCount: deduped.length,
      perQueryHits: perQueryResults.map((r) => ({
        query: r.query,
        hitCount: r.hits.length,
        topScore: r.hits[0]?.score ?? 0,
      })),
    },
  });

  // ─── Stage 3: LLM #2 — synthesize ──────────────────────────────
  const t3 = Date.now();
  const citationsBlock = deduped.length === 0
    ? '(本轮 RAG 没有召回任何片段；请只基于 ChartBrief 写作，不要编造引用。)'
    : deduped.map((d, i) =>
        `[${i + 1}] ${d.chunk.source} (${d.chunk.title}) [score=${d.score.toFixed(3)}] [queries=${d.provenanceQueries.join('|')}]\n` +
        d.chunk.text.slice(0, 600),
      ).join('\n\n');

  const synthMessages = [
    { role: 'system' as const, content: STEP_SYNTHESIZE_SYSTEM },
    { role: 'user' as const, content:
      `【用户问题】\n${brief.question || '(通用分析)'}\n\n` +
      `【ChartBrief】\n${brief.asMarkdown}\n\n` +
      `【理解阶段输出】\n${parsedUnderstand.intermediateUnderstanding || '(理解阶段未给出)'}\n` +
      `  关注用神：${parsedUnderstand.focusYongshen.join('、') || '(无)'}\n` +
      `  细化的提问类型：${parsedUnderstand.refinedQuestionType}\n\n` +
      `【六爻知识库召回片段】\n${citationsBlock}\n\n` +
      `请写综合分析报告。` },
  ];
  let synthResp;
  try {
    synthResp = await llm.chat(synthMessages, { model: modelId, temperature: 0.4, maxTokens: 4096 });
  } catch (e: any) {
    logger.warn(`runAnalysisAgent: synthesize LLM call failed (${e?.message ?? e}); returning template fallback`);
    synthResp = {
      id: 'fallback',
      model: modelId,
      provider: 'unknown' as any,
      content: '',
      role: 'assistant' as const,
      finishReason: 'stop' as const,
    };
  }
  const synthMs = Date.now() - t3;
  pipeline.push({
    stage: 'synthesize',
    durationMs: synthMs,
    meta: {
      model: synthResp.model,
      provider: synthResp.provider,
      usage: synthResp.usage,
      contentLength: (synthResp.content || '').length,
    },
  });

  // ─── Assemble the final AnalysisReport ─────────────────────────
  const reportMarkdown = synthResp.content && synthResp.content.length > 0
    ? synthResp.content
    : synthesizeFallback(brief, parsedUnderstand.intermediateUnderstanding, deduped);

  const citations: RagCitation[] = deduped.map((d) => ({
    source: d.chunk.source,
    snippet: d.chunk.text.slice(0, 200),
    score: d.score,
  }));

  const report: AnalysisReport = {
    question: brief.question,
    understanding: {
      questionType: parsedUnderstand.refinedQuestionType as any,
      userFocus: parsedUnderstand.intermediateUnderstanding?.slice(0, 200) || brief.question,
      missingContext: deriveMissingContext(brief, parsedUnderstand),
    },
    summary: extractSection(reportMarkdown, '卦象概要') || '（综合分析阶段未生成概要段）',
    originalHexagramInterpretation: extractSection(reportMarkdown, '本卦解释') || '',
    changedHexagramInterpretation: extractSection(reportMarkdown, '变卦解释') || '',
    movingLineAnalysis: extractSection(reportMarkdown, '动爻分析') || '',
    shiYingAnalysis: extractSection(reportMarkdown, '世应关系') || '',
    yongshenAnalysis: extractSection(reportMarkdown, '用神分析') || '',
    strengthAndRelations: extractSection(reportMarkdown, '旺衰与关系') || '',
    synthesis: extractSection(reportMarkdown, '综合判断') || reportMarkdown,
    uncertainties: [
      '报告由两次 LLM 调用生成（理解阶段 + 综合分析阶段）；请审阅 debug.pipeline 了解每步的输入与输出。',
      ...(brief.warnings?.length ? [`排盘警告：${brief.warnings.join('；')}`] : []),
    ],
    citations,
  };

  const debug: AnalysisDebug = {
    totalDurationMs: Date.now() - totalStart,
    pipeline,
    brief,
    understanding: {
      refinedQuestionType: parsedUnderstand.refinedQuestionType,
      focusYongshen: parsedUnderstand.focusYongshen,
      ragQueries: parsedUnderstand.ragQueries,
      intermediateUnderstanding: parsedUnderstand.intermediateUnderstanding,
      model: understandResp.model,
      provider: String(understandResp.provider),
      usage: understandResp.usage,
    },
    rag: {
      queries: allQueries,
      perQueryHits: perQueryResults.map((r) => ({
        query: r.query,
        hitCount: r.hits.length,
        topScore: r.hits[0]?.score ?? 0,
      })),
      deduped: deduped.map((d) => ({
        source: d.chunk.source,
        title: d.chunk.title,
        score: d.score,
        provenanceQueries: d.provenanceQueries,
        snippet: d.chunk.text.slice(0, 200),
      })),
    },
    synthesis: {
      model: synthResp.model,
      provider: String(synthResp.provider),
      usage: synthResp.usage,
    },
  };

  return { report, brief, debug };
}

interface ParsedUnderstand {
  refinedQuestionType: string;
  focusYongshen: string[];
  ragQueries: string[];
  intermediateUnderstanding: string;
}

function parseUnderstandResponse(raw: string): ParsedUnderstand {
  const empty: ParsedUnderstand = {
    refinedQuestionType: '其他',
    focusYongshen: [],
    ragQueries: [],
    intermediateUnderstanding: raw, // keep raw so the synthesizer can still see what the LLM said
  };
  if (!raw) return empty;
  // The LLM sometimes wraps the JSON in ```json ... ```; strip that.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const jsonText = fence ? fence[1]!.trim() : raw.trim();
  // Find the first {...} block — LLM may also add a leading sentence.
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start < 0 || end <= start) return empty;
  const slice = jsonText.slice(start, end + 1);
  try {
    const obj = JSON.parse(slice);
    return {
      refinedQuestionType: String(obj.refinedQuestionType ?? '其他'),
      focusYongshen: Array.isArray(obj.focusYongshen) ? obj.focusYongshen.map(String) : [],
      ragQueries: Array.isArray(obj.ragQueries) ? obj.ragQueries.map(String) : [],
      intermediateUnderstanding: String(obj.intermediateUnderstanding ?? ''),
    };
  } catch (e: any) {
    logger.warn(`parseUnderstandResponse: JSON parse failed (${e?.message ?? e}); raw=${raw.slice(0, 200)}`);
    return empty;
  }
}

/** Best-effort section extraction: looks for a markdown heading that
 *  starts with `name` (e.g. "卦象概要" matches "## 卦象概要"). */
function extractSection(markdown: string, name: string): string | null {
  if (!markdown) return null;
  // Heading patterns: "## 卦象概要", "### 卦象概要", "**卦象概要**", "① 卦象概要"...
  const re = new RegExp(
    `^[#>*\\s]*\\d*\\s*[、.)]?\\s*\\**${name}\\**[:：]?\\s*$`,
    'm',
  );
  const m = re.exec(markdown);
  if (!m) return null;
  const start = m.index + m[0].length;
  // Find the next heading (line starting with #) or end of doc.
  const tail = markdown.slice(start);
  const nextHeading = /^\s*#{1,6}\s+/m.exec(tail);
  const end = nextHeading ? nextHeading.index : tail.length;
  return tail.slice(0, end).trim();
}

function deriveMissingContext(brief: ChartBrief, p: ParsedUnderstand): string[] {
  const missing: string[] = [];
  if (!brief.question || brief.question.length < 4) {
    missing.push('问题描述太短或缺失（请补充背景以便更精准地用神定位）');
  }
  if (brief.yongshen.candidates.length === 0) {
    missing.push('程序未给出用神候选（请根据问题类型与卦象在综合分析中自行判断）');
  }
  if (p.focusYongshen.length === 0) {
    missing.push('理解阶段未明确焦点用神（综合分析可能较为泛化）');
  }
  return missing;
}

function synthesizeFallback(
  brief: ChartBrief,
  intermediate: string,
  hits: Array<{ chunk: RagChunk; score: number; provenanceQueries: string[] }>,
): string {
  // Used when the synthesizer LLM call fails. Produces a clean
  // template so the caller still gets something useful.
  const lines: string[] = [];
  lines.push('## 卦象概要');
  lines.push(
    `本卦 **${brief.originalHexagram.name}**（${brief.originalHexagram.palace}宫·${brief.originalHexagram.palaceType}，${brief.originalHexagram.element}）。` +
    (brief.changedHexagram ? `变卦 **${brief.changedHexagram.name}**。` : '本卦与变卦相同（无动爻）。') +
    (brief.movingLines.length ? `动爻：第${brief.movingLines.join('、')}爻。` : '无动爻。'),
  );
  if (intermediate) {
    lines.push('\n## 理解阶段');
    lines.push(intermediate);
  }
  if (hits.length > 0) {
    lines.push('\n## 召回的知识库片段');
    for (const h of hits.slice(0, 4)) {
      lines.push(`- [cite: ${h.chunk.source}] ${h.chunk.text.slice(0, 200)}`);
    }
  }
  lines.push('\n## 综合判断');
  lines.push('（综合分析阶段 LLM 不可用，仅返回 ChartBrief + 召回片段 + 理解阶段输出。请重新提问或检查 LLM provider 配置。）');
  return lines.join('\n');
}

// Re-export the rag search so DivinationTool can still call it.
export { ragSearch };
