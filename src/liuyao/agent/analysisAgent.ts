/**
 * Analysis agent — multi-stage pipeline that produces the final
 * AnalysisReport from a stored ChartResult.
 *
 * Two modes:
 *
 *   Default (3 stages, 2 LLM calls, single RAG pass):
 *
 *     Stage 0  buildChartBrief(chart)         — pure, deterministic
 *     Stage 1  LLM #1 — understand            — brief + question → JSON
 *                                                plan: refined type,
 *                                                focus 用神, RAG queries,
 *                                                intermediate prose
 *     Stage 2  RAG retrieve                   — union of LLM-proposed +
 *                                                auto queries → dedupe
 *     Stage 3  LLM #2 — synthesize            — brief + Stage 1 + RAG
 *                                                hits → 6/9-section
 *                                                markdown report
 *
 *   Thinking mode (5+ stages, 1 + N + 1 LLM calls, multi-angle RAG):
 *
 *     Stage 0  buildChartBrief(chart)
 *     Stage 1  LLM #1 — understand + plan     — same as default, but
 *                                                the LLM also returns
 *                                                an `angles[]` list
 *                                                (3-5 independent
 *                                                perspectives, each
 *                                                with its own RAG
 *                                                queries)
 *     Stage 2  for each angle in parallel:
 *                (a) searchMany(angle.queries)   — RAG per angle
 *                (b) LLM "analyze from this     — per-angle prose
 *                    angle" using its RAG hits    grounded in the brief
 *                                                + its RAG hits
 *     Stage 3  LLM #N — synthesize            — brief + Stage 1
 *                                                understanding +
 *                                                per-angle analyses
 *                                                → 6/9-section report
 *
 *   The thinking mode is the "multi-agent" path: each angle is an
 *   independent LLM call with its own RAG context, so they don't
 *   bleed into each other. A final synthesis call merges the
 *   per-angle prose into the user-facing report. Cost: roughly
 *   1 + N + 1 LLM calls instead of 2; the per-angle RAG dedupes
 *   aggressively so the final synthesis doesn't see a lot of
 *   repeated context.
 *
 *   Both modes return a structured `AnalysisResult` (not just
 *   prose) so the chat route can surface the timeline via
 *   `debug.pipeline`.
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

const STEP_UNDERSTAND_THINKING_SYSTEM = `你是六爻分析 Agent 的"理解阶段"（thinking 模式）。
你的输入是已经排好的 ChartBrief（六爻结构化信息），以及用户的原始问题。
你的任务除了常规的理解与 RAG 查询之外，还必须**规划多个独立分析角度**。

每个角度的设计原则：
- 角度之间要正交 / 互补，不能重复。例如：
  角度 A "用神与旺衰" 看核心用神的强弱；
  角度 B "世应与动变" 看求占者与所问之物的关系 + 动爻的走向；
  角度 C "时间与月令" 看排盘时间对用神 / 世爻的生克影响；
  角度 D "古断参考" 找知识库里类似卦例的判辞做类比；
  角度 E "格局与神煞" 看伏神 / 飞神 / 三合 / 六合 等格局。
- 角度数：返回 3-5 个，不要太多（成本高），也不要太少（覆盖不全）。
- 每个角度给 2-3 个该角度专属的 RAG 查询 —— **与角度主题强相关**，
  不要用通用查询。查询举例：
  角度 "用神与旺衰" → ["用神旺衰 月令生克", "用神 空破 静卦", "妻财 持世 应期"]
  角度 "世应与动变" → ["世爻 应爻 生克", "动爻 化出 回头生", "世空 动化"]
  角度 "时间与月令" → ["月令 日辰 旺衰", "起卦时间 卦气", "节气 卦运"]
  角度 "古断参考"   → ["增删卜易 类似卦例", "黄金策 歌诀", "实例应用 类似案例"]
  角度 "格局与神煞" → ["伏神 飞神", "三合 六合", "六神 螣蛇 白虎"]

返回严格的 JSON（不要包裹在 markdown 代码块中）：
{
  "refinedQuestionType": "求财" | "求事业" | "求感情" | ...,
  "focusYongshen": ["妻财", "官鬼", ...],
  "ragQueries": ["总览查询1", "总览查询2"],   // 顶层全局查询，会跟各角度查询合并
  "intermediateUnderstanding": "200-400 字的中间理解",
  "angles": [
    {
      "name": "用神与旺衰",
      "perspective": "用神妻财寅木的旺衰、是否空破、与日辰月令的生克关系",
      "ragQueries": ["用神旺衰 月令", "妻财 空破", "妻财 持世 应期"]
    },
    {
      "name": "世应与动变",
      "perspective": "世爻与应爻的五行生克，动爻化出的走向",
      "ragQueries": ["世爻 应爻 生克", "动爻 化出 回头生", "世空 动化"]
    }
  ]
}

严格规则：
- 不能重新排盘或修改 ChartBrief 中的任何字段。
- 不能下"吉/凶"绝对断言。
- angles 至少 3 个，至多 5 个；每个 angles[i].ragQueries 2-3 个。
- 所有查询必须是六爻知识库里可能存在的概念。`;

const STEP_ANGLE_SYSTEM = `你是六爻分析 Agent 的"单角度分析"阶段。
你的输入是：
- ChartBrief（已经排好的结构化信息，**不要重新排盘**）
- 理解阶段规划的本角度（name + perspective）
- 仅供本角度使用的 RAG 召回片段（每条带 [cite: source] 标签）
- 用户的原始问题

你的任务：仅从你被分配的"角度"出发，写一段 300-500 字的"角度分析"。
要求：
1. 严格基于 ChartBrief 中的结构化信息 — 不能改写任何排盘字段。
2. 引用召回片段时，**必须**保留 [cite: source] 标签，例如：
   "妻财持世，求财可得 [cite: docs/base_knowledge/六爻用神.md]"。
   没有引用就**不要**编造 [cite: ...] 标签。
3. 角度要专一：只看 perspective 指定的方向，不要越界做综合判断。
4. 最后用一句话总结本角度的核心发现，供综合分析阶段合并。

输出 Markdown，不要包裹在 JSON 里。`;

const STEP_SYNTHESIZE_THINKING_SYSTEM = `你是六爻分析 Agent 的"综合分析阶段"（thinking 模式）。
你的输入是：
- ChartBrief（已经排好的结构化信息，**不要重新排盘**）
- 理解阶段的中间理解
- 每个独立分析角度的输出（每个角度都已经从自己的 perspective 出发
  分析过，且都附带了 RAG 引用）
- 用户的原始问题

你的任务是写一份 6-9 段的综合分析报告。语言必须与用户问题保持一致；用户用中文就全程中文。
要求：
1. 严格基于 ChartBrief 中的结构化信息 — 不能改写本卦/变卦/六亲/六神/世应/纳甲/旬空/旺衰/用神候选。
2. **必须整合多个角度的发现**。如果角度 A 说"用神旺"，角度 B 说"世爻空"，
   你需要把两个事实同时呈现并讨论它们的关系，而不是只挑一个。
3. 引用召回片段时，**必须**保留 [cite: source] 标签，例如：
   "妻财持世，求财可得 [cite: docs/base_knowledge/六爻用神.md]"。
   没有引用就**不要**编造 [cite: ...] 标签。
4. 不能下"一定成/一定不成"的绝对断言 — 给出"倾向于 / 有利于 / 不利于 / 需注意"的谨慎判断。
5. 面向用户输出时，不要出现 ChartBrief、RAG、LLM、pipeline、debug、JSON、Markdown、文件路径、provider、token 等工程术语。
6. 报告结构：
   ① 卦象概要：简述本卦/变卦/动爻/世应
   ② 本卦解释：本卦的卦象含义（结合卦辞、卦理、卦宫五行）
   ③ 动爻分析：动爻的爻辞含义、动爻化出、与日辰月令的关系
   ④ 用神分析：用神候选的旺衰、与日辰/世应/动爻的生克
   ⑤ 世应关系：世爻与应爻的五行生克
   ⑥ 综合判断：结合以上各段 + 多个角度的发现，给出对用户问题的倾向性判断和需要补充的信息
7. 最后只在确实需要时列一个"不确定性与补充信息"段落，内容必须是用户能理解的现实信息，例如排盘警告、问题背景不足、需要用户补充的事实。
8. 在报告开头，列出本次深度推演涉及的所有分析角度名称，格式如："> 分析角度：用神与旺衰 / 世应与动变 / 时间与月令"

输出 Markdown，不要包裹在 JSON 里。`;

const STEP_SYNTHESIZE_SYSTEM = `你是六爻分析 Agent 的"综合分析阶段"。
你的输入是：
- ChartBrief（已经排好的结构化信息，**不要重新排盘**）
- 上一阶段（理解阶段）的中间理解
- 从六爻知识库召回的相关片段（每条带 [cite: source] 标签）
- 用户的原始问题

你的任务是写一份 6-9 段的综合分析报告。语言必须与用户问题保持一致；用户用中文就全程中文。
要求：
1. 严格基于 ChartBrief 中的结构化信息 — 不能改写本卦/变卦/六亲/六神/世应/纳甲/旬空/旺衰/用神候选。
2. 引用召回片段时，**必须**保留 [cite: source] 标签，例如：
   "妻财持世，求财可得 [cite: docs/base_knowledge/六爻用神.md]"。
   没有引用就**不要**编造 [cite: ...] 标签。
3. 不能下"一定成/一定不成"的绝对断言 — 给出"倾向于 / 有利于 / 不利于 / 需注意"的谨慎判断。
4. 面向用户输出时，不要出现 ChartBrief、RAG、LLM、pipeline、debug、JSON、Markdown、文件路径、provider、token 等工程术语。
5. 报告结构：
   ① 卦象概要：简述本卦/变卦/动爻/世应
   ② 本卦解释：本卦的卦象含义（结合卦辞、卦理、卦宫五行）
   ③ 动爻分析：动爻的爻辞含义、动爻化出、与日辰月令的关系
   ④ 用神分析：用神候选的旺衰、与日辰/世应/动爻的生克
   ⑤ 世应关系：世爻与应爻的五行生克
   ⑥ 综合判断：结合以上各段，给出对用户问题的倾向性判断和需要补充的信息
6. 最后只在确实需要时列一个"不确定性与补充信息"段落，内容必须是用户能理解的现实信息，例如排盘警告、问题背景不足、需要用户补充的事实。

输出 Markdown，不要包裹在 JSON 里。`;

export interface PipelineStepDebug {
  /** Stage id. */
  stage:
    | 'build-brief'
    | 'understand'
    | 'rag-retrieve'
    | 'synthesize'
    | 'angle-analyze';
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Free-form per-stage metadata (model, token usage, query list, ...). */
  meta: Record<string, unknown>;
  /** When stage === 'angle-analyze', the angle this step is for. */
  angleName?: string;
}

export interface AngleDebug {
  /** Angle name as planned by the LLM (e.g. "用神与旺衰"). */
  name: string;
  /** One-sentence perspective describing what this angle investigates. */
  perspective: string;
  /** RAG queries that were run for this angle. */
  ragQueries: string[];
  /** Top-k deduped hits actually used by this angle's LLM call. */
  hits: Array<{
    source: string;
    title: string;
    score: number;
    snippet: string;
  }>;
  /** The LLM's per-angle analysis (markdown). May be empty if the LLM call failed. */
  analysis: string;
  /** Model + usage stats for this angle's LLM call. */
  model: string;
  provider: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number; cacheHitTokens?: number };
}

export interface AnalysisDebug {
  /** Total wall-clock for the whole pipeline. */
  totalDurationMs: number;
  /** True if the thinking path was used. */
  thinking: boolean;
  /** Per-stage breakdown. */
  pipeline: PipelineStepDebug[];
  /** The brief rendered as markdown (Stage 0 output). */
  brief: ChartBrief;
  /** Stage 1 LLM call: refined type, focus, queries, intermediate prose, plus the planned angles (when thinking). */
  understanding: {
    refinedQuestionType: string;
    focusYongshen: string[];
    ragQueries: string[];
    intermediateUnderstanding: string;
    angles: Array<{ name: string; perspective: string; ragQueries: string[] }>;
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
  /**
   * Thinking-mode per-angle results. Empty array when thinking is off.
   * Each entry is the LLM's prose for one angle + its scoped RAG context.
   */
  perAngle: AngleDebug[];
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
    /**
     * When true, run the multi-angle "thinking" pipeline: 1 + N + 1
     * LLM calls, each angle doing its own RAG pass. Slower and
     * costs more tokens, but produces a more thoroughly-grounded
     * report. Off by default.
     */
    thinking?: boolean;
    /**
     * When `thinking` is true, how many independent angles to run.
     * Clamped to [1, 5]. Default 3.
     */
    angles?: number;
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
  const thinking = options.thinking === true;
  // Clamp `angles` to [1, 5] with a default of 3.
  const angleBudget = (() => {
    const raw = Number(options.angles);
    if (!Number.isFinite(raw)) return 3;
    return Math.max(1, Math.min(5, Math.floor(raw)));
  })();

  const t1 = Date.now();
  // Pick the right system prompt + token budget. Thinking mode
  // asks the LLM to also plan 3-5 angles, so the output budget is
  // larger; the JSON parser handles either shape.
  const understandSysPrompt = thinking ? STEP_UNDERSTAND_THINKING_SYSTEM : STEP_UNDERSTAND_SYSTEM;
  const understandMaxTokens = thinking ? 4096 : 2048;
  const understandMessages = [
    { role: 'system' as const, content: understandSysPrompt },
    { role: 'user' as const, content:
      `【用户问题】\n${brief.question || '(用户没有明确问题，请基于卦象给出通用分析)'}\n\n` +
      `【ChartBrief】\n${brief.asMarkdown}\n\n` +
      (thinking ? `【thinking 模式】请规划 ${angleBudget} 个分析角度。\n\n` : '') +
      `请按要求返回 JSON。` },
  ];
  let understandResp;
  try {
    understandResp = await llm.chat(understandMessages, { model: modelId, temperature: 0.3, maxTokens: understandMaxTokens });
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
      thinking,
      angleBudget,
      refinedQuestionType: parsedUnderstand.refinedQuestionType,
      focusYongshen: parsedUnderstand.focusYongshen,
      ragQueries: parsedUnderstand.ragQueries,
      anglesPlanned: parsedUnderstand.angles.length,
      rawContentLength: (understandResp.content || '').length,
    },
  });

  // ─── Stages 2 + 3: RAG + synthesize ────────────────────────────
  // Two paths share most of the same data shapes. The thinking
  // branch runs RAG + an LLM call per angle, then a final synthesis.
  // The default branch runs a single RAG pass + a single LLM
  // synthesis. Both produce:
  //   - perQueryResults: per-query RAG hit list (for the debug block)
  //   - deduped:         deduped across all queries (final citations)
  //   - perAngle:        per-angle RAG + LLM analysis (thinking only)
  //   - synthResp:       final synthesis LLM response
  //   - reportMarkdown:  the final user-facing prose
  let perQueryResults: Array<{ query: string; hits: Array<{ chunk: RagChunk; score: number }> }> = [];
  let perAngle: AngleDebug[] = [];
  let allQueries: string[] = [];
  let deduped: ReturnType<typeof dedupeManyHits> = [];
  // Pre-declared with a safe default; both branches (default +
  // thinking) reassign before use. The default below matches the
  // shape the chat routes / callers expect.
  let synthResp: { id: string; model: string; provider: string; content: string; role: 'assistant'; finishReason: 'stop' | 'length' | 'tool_use' | 'content_filter'; usage?: { inputTokens: number; outputTokens: number; totalTokens: number; cacheHitTokens?: number } } = {
    id: 'uninitialized',
    model: modelId,
    provider: 'unknown' as any,
    content: '',
    role: 'assistant' as const,
    finishReason: 'stop' as const,
  };

  if (!thinking) {
    // ── DEFAULT PATH: 1 RAG pass + 1 final synthesis ─────────────
    const t2 = Date.now();
    const autoQueries: string[] = [];
    if (brief.originalHexagram.name) autoQueries.push(brief.originalHexagram.name);
    if (brief.questionType) autoQueries.push(`六爻 ${brief.questionType}`);
    for (const ys of parsedUnderstand.focusYongshen) autoQueries.push(ys);
    allQueries = Array.from(new Set([...parsedUnderstand.ragQueries, ...autoQueries]))
      .map((q) => q.trim())
      .filter(Boolean);

    if (allQueries.length > 0) {
      perQueryResults = await searchMany(allQueries, 4, requesterId, isAdmin);
    }
    deduped = dedupeManyHits(perQueryResults, 8);
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

    // Final synthesis
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
  } else {
    // ── THINKING PATH: per-angle RAG + per-angle LLM, in parallel
    // The LLM-planned angles (parsedUnderstand.angles) are preferred;
    // we pad with DEFAULT_ANGLES up to `angleBudget`. Each angle
    // does its own RAG pass + its own LLM "analyze from this angle"
    // call. We then run a final synthesis that sees all per-angle
    // outputs + their citations.
    const angles = pickAngles(parsedUnderstand.angles, angleBudget);
    if (angles.length === 0) {
      // Shouldn't happen — pickAngles always pads — but be safe.
      logger.warn('runAnalysisAgent: thinking mode produced 0 angles; falling back to default RAG path');
      const t2 = Date.now();
      const autoQueries: string[] = [];
      if (brief.originalHexagram.name) autoQueries.push(brief.originalHexagram.name);
      if (brief.questionType) autoQueries.push(`六爻 ${brief.questionType}`);
      for (const ys of parsedUnderstand.focusYongshen) autoQueries.push(ys);
      allQueries = Array.from(new Set([...parsedUnderstand.ragQueries, ...autoQueries]))
        .map((q) => q.trim()).filter(Boolean);
      if (allQueries.length > 0) {
        perQueryResults = await searchMany(allQueries, 4, requesterId, isAdmin);
      }
      deduped = dedupeManyHits(perQueryResults, 8);
      const ragMs = Date.now() - t2;
      pipeline.push({ stage: 'rag-retrieve', durationMs: ragMs, meta: { fallback: true, queryCount: allQueries.length, dedupedCount: deduped.length } });
    } else {
      // Per-angle: RAG first (per-angle scoped), then LLM per angle.
      // We run all RAG passes in parallel, then all angle LLM calls
      // in parallel — the two phases are sequential so each angle
      // LLM sees only its own RAG hits.
      const ragStart = Date.now();
      const perAngleRag = await Promise.all(
        angles.map(async (angle) => {
          const queries = angle.ragQueries.length > 0 ? angle.ragQueries : [angle.name];
          const perQuery = await searchMany(queries, 4, requesterId, isAdmin).catch(() => []);
          // Track globally for the debug `rag` block too.
          for (const r of perQuery) perQueryResults.push(r);
          const angleDeduped = dedupeManyHits(perQuery, 5);
          return { angle, queries, perQuery, deduped: angleDeduped };
        }),
      );
      const ragMs = Date.now() - ragStart;
      // Record one pipeline step per angle (RAG) — useful for the
      // debug timeline when thinking is on.
      for (const { angle, queries, deduped: angleDeduped } of perAngleRag) {
        pipeline.push({
          stage: 'rag-retrieve',
          durationMs: ragMs,
          meta: {
            angle: angle.name,
            queryCount: queries.length,
            dedupedCount: angleDeduped.length,
          },
          angleName: angle.name,
        });
      }
      // Union the per-angle queries for the global `rag.queries` field.
      allQueries = Array.from(new Set(perAngleRag.flatMap((r) => r.queries)));
      // For the final synthesis's `citations`, take the global
      // deduped top-k (across all angles).
      deduped = dedupeManyHits(perQueryResults, 8);

      // Phase 2: LLM per angle, in parallel.
      const angleStart = Date.now();
      perAngle = await Promise.all(
        perAngleRag.map(async ({ angle, deduped: angleDeduped }) => {
          const angleCitationsBlock = angleDeduped.length === 0
            ? '(本角度 RAG 没有召回任何片段；请只基于 ChartBrief 写作，不要编造引用。)'
            : angleDeduped.map((d, i) =>
                `[${i + 1}] ${d.chunk.source} (${d.chunk.title}) [score=${d.score.toFixed(3)}] [queries=${d.provenanceQueries.join('|')}]\n` +
                d.chunk.text.slice(0, 500),
              ).join('\n\n');
          const angleMessages = [
            { role: 'system' as const, content: STEP_ANGLE_SYSTEM },
            { role: 'user' as const, content:
              `【用户问题】\n${brief.question || '(通用分析)'}\n\n` +
              `【本角度】\n${angle.name}\n${angle.perspective}\n\n` +
              `【ChartBrief】\n${brief.asMarkdown}\n\n` +
              `【本角度的 RAG 召回片段】\n${angleCitationsBlock}\n\n` +
              `请按本角度的 perspective 写一段 300-500 字的分析。` },
          ];
          const t = Date.now();
          let angleResp;
          try {
            angleResp = await llm.chat(angleMessages, { model: modelId, temperature: 0.4, maxTokens: 1500 });
          } catch (e: any) {
            logger.warn(`runAnalysisAgent: angle "${angle.name}" LLM call failed (${e?.message ?? e}); using empty analysis`);
            angleResp = {
              id: 'fallback',
              model: modelId,
              provider: 'unknown' as any,
              content: `（本角度 LLM 不可用；perspective：${angle.perspective}）`,
              role: 'assistant' as const,
              finishReason: 'stop' as const,
            };
          }
          const angleMs = Date.now() - t;
          // One pipeline step per angle.
          pipeline.push({
            stage: 'angle-analyze',
            durationMs: angleMs,
            meta: {
              model: angleResp.model,
              provider: angleResp.provider,
              usage: angleResp.usage,
              ragHits: angleDeduped.length,
              outputLength: (angleResp.content || '').length,
            },
            angleName: angle.name,
          });
          return {
            name: angle.name,
            perspective: angle.perspective,
            ragQueries: angle.ragQueries,
            hits: angleDeduped.map((d) => ({
              source: d.chunk.source,
              title: d.chunk.title,
              score: d.score,
              snippet: d.chunk.text.slice(0, 200),
            })),
            analysis: angleResp.content || '',
            model: angleResp.model,
            provider: String(angleResp.provider),
            usage: angleResp.usage,
          } satisfies AngleDebug;
        }),
      );
      logger.debug(`runAnalysisAgent: thinking mode ran ${perAngle.length} angle analyses in ${Date.now() - angleStart}ms`);

      // Phase 3: final synthesis with all per-angle context.
      const t3 = Date.now();
      const perAngleBlock = perAngle.length === 0
        ? '(无独立分析角度)'
        : perAngle.map((a, i) =>
            `### 角度 ${i + 1}：${a.name}\n` +
            `**Perspective**：${a.perspective}\n` +
            `**分析**：\n${a.analysis || '(无)'}\n` +
            (a.hits.length > 0 ? `**本角度 RAG 召回**：\n${a.hits.map((h, j) => `  [${j + 1}] ${h.source} (${h.title}) [score=${h.score.toFixed(3)}] — ${h.snippet.slice(0, 150)}`).join('\n')}\n` : ''),
          ).join('\n\n');
      const angleNames = perAngle.map((a) => a.name).join(' / ');
      const synthMessages = [
        { role: 'system' as const, content: STEP_SYNTHESIZE_THINKING_SYSTEM },
        { role: 'user' as const, content:
          `【用户问题】\n${brief.question || '(通用分析)'}\n\n` +
          `【ChartBrief】\n${brief.asMarkdown}\n\n` +
          `【分析角度】\n${angleNames}\n\n` +
          `【理解阶段输出】\n${parsedUnderstand.intermediateUnderstanding || '(理解阶段未给出)'}\n` +
          `  关注用神：${parsedUnderstand.focusYongshen.join('、') || '(无)'}\n` +
          `  细化的提问类型：${parsedUnderstand.refinedQuestionType}\n\n` +
          `【多角度分析】\n${perAngleBlock}\n\n` +
          `请整合以上多个角度的发现，写一份 6-9 段综合分析报告。` },
      ];
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
          angleCount: perAngle.length,
        },
      });
    }
  }

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
      ...(brief.warnings?.length ? [`排盘警告：${brief.warnings.join('；')}`] : []),
      ...deriveMissingContext(brief, parsedUnderstand),
    ],
    citations,
  };

  const debug: AnalysisDebug = {
    totalDurationMs: Date.now() - totalStart,
    thinking,
    pipeline,
    brief,
    understanding: {
      refinedQuestionType: parsedUnderstand.refinedQuestionType,
      focusYongshen: parsedUnderstand.focusYongshen,
      ragQueries: parsedUnderstand.ragQueries,
      intermediateUnderstanding: parsedUnderstand.intermediateUnderstanding,
      angles: parsedUnderstand.angles,
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
    perAngle,
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
  angles: PlannedAngle[];
}

interface PlannedAngle {
  name: string;
  perspective: string;
  ragQueries: string[];
}

function parseUnderstandResponse(raw: string): ParsedUnderstand {
  const empty: ParsedUnderstand = {
    refinedQuestionType: '其他',
    focusYongshen: [],
    ragQueries: [],
    intermediateUnderstanding: raw, // keep raw so the synthesizer can still see what the LLM said
    angles: [],
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
    const anglesRaw = Array.isArray(obj.angles) ? obj.angles : [];
    const angles: PlannedAngle[] = anglesRaw
      .map((a: any) => ({
        name: String(a?.name ?? '').trim(),
        perspective: String(a?.perspective ?? '').trim(),
        ragQueries: Array.isArray(a?.ragQueries) ? a.ragQueries.map(String).map((q: string) => q.trim()).filter(Boolean) : [],
      }))
      .filter((a: PlannedAngle) => a.name.length > 0);
    return {
      refinedQuestionType: String(obj.refinedQuestionType ?? '其他'),
      focusYongshen: Array.isArray(obj.focusYongshen) ? obj.focusYongshen.map(String) : [],
      ragQueries: Array.isArray(obj.ragQueries) ? obj.ragQueries.map(String) : [],
      intermediateUnderstanding: String(obj.intermediateUnderstanding ?? ''),
      angles,
    };
  } catch (e: any) {
    logger.warn(`parseUnderstandResponse: JSON parse failed (${e?.message ?? e}); raw=${raw.slice(0, 200)}`);
    return empty;
  }
}

/**
 * Default angles used when the LLM doesn't plan any (or when its
 * JSON parse fails). These are the standard liuyao reading lenses —
 * 用神旺衰, 世应动变, 时间月令, 古断参考. If the caller asked for
 * fewer angles, this list is truncated; if more, the LLM's list
 * (if any) is preferred.
 */
const DEFAULT_ANGLES: PlannedAngle[] = [
  {
    name: '用神与旺衰',
    perspective: '用神候选的旺衰、是否空破、与日辰月令的生克关系',
    ragQueries: ['用神旺衰 月令', '用神 空破', '用神 持世 应期'],
  },
  {
    name: '世应与动变',
    perspective: '世爻与应爻的五行生克，动爻化出的走向，伏神飞神',
    ragQueries: ['世爻 应爻 生克', '动爻 化出 回头生', '伏神 飞神'],
  },
  {
    name: '时间与月令',
    perspective: '排盘时间（年/月/日/时四柱 + 节气）对用神 / 世爻的生克影响',
    ragQueries: ['月令 日辰 旺衰', '起卦时间 节气', '卦气 进退'],
  },
  {
    name: '古断参考',
    perspective: '从知识库找类似卦例的判辞做类比',
    ragQueries: ['增删卜易 类似卦例', '黄金策 歌诀', '实例应用 类似案例'],
  },
];

/** Pick at most `count` angles: prefer LLM-planned, pad with defaults. */
function pickAngles(planned: PlannedAngle[], count: number): PlannedAngle[] {
  const out: PlannedAngle[] = [];
  for (const a of planned) {
    if (out.length >= count) break;
    if (a.ragQueries.length === 0) continue;
    out.push(a);
  }
  for (const a of DEFAULT_ANGLES) {
    if (out.length >= count) break;
    if (out.some((x) => x.name === a.name)) continue;
    out.push(a);
  }
  return out;
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
    lines.push('\n## 初步观察');
    lines.push(intermediate);
  }
  if (hits.length > 0) {
    lines.push('\n## 可参考依据');
    for (const h of hits.slice(0, 4)) {
      lines.push(`- [cite: ${h.chunk.source}] ${h.chunk.text.slice(0, 200)}`);
    }
  }
  lines.push('\n## 综合判断');
  lines.push('当前暂时无法生成完整解读，只能先返回排盘摘要和可参考依据。请稍后重试或检查模型服务配置。');
  return lines.join('\n');
}

// Re-export the rag search so DivinationTool can still call it.
export { ragSearch };
