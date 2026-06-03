/**
 * Report template (per design.md §13). Builds the 6-section (MVP) or
 * 9-section (full) textual report from a ChartResult. This is the
 * "interpreter" half of the agent — it does not perform any
 * computation, only strings together what the chart already contains.
 *
 * The full LLM-driven agent (analysisAgent.ts) wraps this template in
 * a system prompt that calls the LLM to enrich the prose; for now the
 * template gives a faithful, neutral summary that respects the "Agent
 * 不能修改程序排盘结果" rule.
 */
import type { AnalysisReport, QuestionUnderstanding, RagCitation } from '../types/agent';
import type { ChartResult } from '../types/chart';
import { search } from '../rag/index';
import { detectQuestionType, missingContextFor } from './questionClassifier';

const TRIGRAM_NAME: Record<string, string> = {
  '乾': '乾天', '坤': '坤地', '震': '震雷', '巽': '巽风',
  '坎': '坎水', '离': '离火', '艮': '艮山', '兑': '兑泽',
};

function formatLine(line: any): string {
  const tags: string[] = [];
  if (line.isShi) tags.push('世爻');
  if (line.isYing) tags.push('应爻');
  const tagStr = tags.length ? `（${tags.join('、')}）` : '';
  const yx = line.yinYang === '阳' ? '—' : '--';
  return `第${line.position}爻 ${yx} ${line.branch}${line.element} ${line.sixRelative} 临${line.sixGod}${tagStr}`;
}

function summariseChart(chart: ChartResult): string {
  const orig = chart.originalHexagram;
  const chg = chart.changedHexagram;
  const lines = chart.lines as any[];
  return [
    `本卦为${orig.name}（${TRIGRAM_NAME[orig.upper] ?? orig.upper}上 / ${TRIGRAM_NAME[orig.lower] ?? orig.lower}下），` +
      `属${orig.palace}宫，五行属${orig.element}。`,
    chg && chg.name !== orig.name ? `变卦为${chg.name}。` : '本卦与变卦相同（无动爻）。',
    chart.movingLines.length
      ? `动爻为${chart.movingLines.map((p) => `第${p}爻`).join('、')}。`
      : '无动爻。',
    `世爻在第${lines.find((l) => l.isShi)?.position}爻，应爻在第${lines.find((l) => l.isYing)?.position}爻。`,
  ].join('\n');
}

function movingLineAnalysis(chart: ChartResult): string {
  if (chart.movingLines.length === 0) return '无动爻。';
  return (chart.lines as any[])
    .filter((l) => l.moving)
    .map((l) => `${formatLine(l)} 动。`)
    .join('\n');
}

function shiYingAnalysis(chart: ChartResult): string {
  const lines = chart.lines as any[];
  const shi = lines.find((l) => l.isShi);
  const ying = lines.find((l) => l.isYing);
  if (!shi || !ying) return '世应信息不完整。';
  return `世爻 ${shi.branch}${shi.element} 临${shi.sixGod}；` +
    `应爻 ${ying.branch}${ying.element} 临${ying.sixGod}。` +
    `世应五行生克与冲合关系由程序排盘给出（见 relations 字段）。`;
}

function yongshenAnalysis(chart: ChartResult): string {
  if (!chart.yongshen || chart.yongshen.candidates.length === 0) {
    return '问题未提供或程序未给出用神候选。';
  }
  return chart.yongshen.candidates
    .map((c) => `用神候选：${c.relative}（出现在第${c.positions.join('、')}爻；置信度：${c.confidence}）`)
    .join('\n');
}

function strengthRelations(chart: ChartResult): string {
  const parts: string[] = [];
  if (chart.relations?.lineRelations?.length) {
    parts.push('地支关系：' + chart.relations.lineRelations.map((r) => r.description).join('；'));
  }
  if (chart.transformations?.length) {
    parts.push('动爻化出：' + chart.transformations
      .map((t) => `第${t.position}爻由${t.fromBranch}(${t.fromElement})→${t.toBranch}(${t.toElement})：${t.relation}`)
      .join('；'));
  }
  if (chart.warnings?.length) {
    parts.push('排盘警告：' + chart.warnings.join('；'));
  }
  return parts.length ? parts.join('\n') : '本部分信息由程序排盘给出（relations / transformations 字段）。';
}

function defaultSynthesis(chart: ChartResult): string {
  return [
    '从当前排盘标签看：',
    `- 本卦「${chart.originalHexagram.name}」属${chart.originalHexagram.palace}宫、五行${chart.originalHexagram.element}；` +
      chart.movingLines.length
        ? `动爻 ${chart.movingLines.length} 个` + (chart.changedHexagram?.name ? `，变卦「${chart.changedHexagram.name}」` : '')
        : '，本卦与变卦相同',
    '- 世应在上述爻位，请结合 relations 字段给出的地支冲合与动爻化出判断阻力与方向。',
    'Agent 不做吉凶的绝对断言；最终判断需结合用户问题背景、卦宫五行与具体用神旺衰。',
  ].join('\n');
}

/** Build a questionType-driven initial understanding. */
function buildUnderstanding(chart: ChartResult, question?: string): QuestionUnderstanding {
  return {
    questionType: (chart.questionType ?? detectQuestionType(question)) as any,
    userFocus: question ?? '',
    missingContext: missingContextFor(question),
  };
}

/** Assemble the full MVP 6-section report.
 *
 * `requesterId` + `isAdmin` scope the RAG search so the report only
 * cites chunks the caller is allowed to see (system-scope + the
 * caller's own user-scope uploads). Admin sees everything.
 */
export async function buildReport(
  chart: ChartResult,
  requesterId: string,
  isAdmin: boolean = false,
): Promise<AnalysisReport> {
  const question = chart.question ?? '';
  const understanding = buildUnderstanding(chart, question);

  // Retrieve top-k knowledge-base citations relevant to the question.
  const citationQuery = [
    question,
    chart.originalHexagram.name,
    chart.changedHexagram?.name ?? '',
    (chart.yongshen?.candidates ?? []).map((c) => c.relative).join(' '),
  ].filter(Boolean).join(' ');
  let top = await search(citationQuery, 4, requesterId, isAdmin).catch(() => []);
  if (top.length === 0) {
    // Fallback: pull a few generic chunks so the agent has something to cite.
    top = await search(chart.originalHexagram.name, 4, requesterId, isAdmin).catch(() => []);
  }
  const citations: RagCitation[] = top.map(({ chunk, score }) => ({
    source: `${chunk.source} (${chunk.title})`,
    snippet: chunk.text.slice(0, 200),
    score,
  }));

  return {
    question,
    understanding,
    summary: summariseChart(chart),
    originalHexagramInterpretation: `本卦「${chart.originalHexagram.name}」属${chart.originalHexagram.palace}宫，卦宫五行${chart.originalHexagram.element}。` +
      `本部分由 Agent 解释卦象含义（暂为占位实现 — 后续接入 LLM 时替换）。`,
    changedHexagramInterpretation: chart.changedHexagram && chart.changedHexagram.name !== chart.originalHexagram.name
      ? `变卦「${chart.changedHexagram.name}」表示事情后续发展方向（占位解释）。`
      : '本卦与变卦相同（无动爻），不存在变卦方向。',
    movingLineAnalysis: movingLineAnalysis(chart),
    shiYingAnalysis: shiYingAnalysis(chart),
    yongshenAnalysis: yongshenAnalysis(chart),
    strengthAndRelations: strengthRelations(chart),
    synthesis: defaultSynthesis(chart),
    uncertainties: [
      '本报告为结构化模板输出，卦象解释与综合判断的深度依赖 LLM 接入。',
      ...understanding.missingContext.map((m) => `用户信息缺失：${m}`),
    ],
    citations,
  };
}
