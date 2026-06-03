/**
 * Analysis agent — thin orchestrator over the report template.
 *
 * Faithful to design.md §12: the agent is not allowed to recompute
 * any chart field, only interpret. We delegate the interpretation to
 * the template (reportTemplate.ts) which renders a structured
 * AnalysisReport from the ChartResult, grounded in RAG citations
 * pulled from docs/base_knowledge.
 *
 * When an LLM is wired in, this file becomes the place to do the
 * system-prompt assembly + LLM call; for now it just calls the
 * template.
 */
import type { AnalysisReport } from '../types/agent';
import type { ChartResult } from '../types/chart';
import { buildReport } from './reportTemplate';

/** The system prompt the agent would use (kept here for documentation). */
export const AGENT_SYSTEM_PROMPT = `
你是六爻分析 Agent。
你不能自行排盘。
你不能自行修改本卦、变卦、六亲、六神、世应、纳甲、旬空、旺衰等程序结果。
所有结构化排盘信息必须来自 ChartResult。
你的任务是解释 ChartResult、组织分析、指出不确定性，并根据用户问题给出谨慎判断。
如果 ChartResult 缺少关键信息，你必须说明缺失项，而不是自行补全。
`;

/** Run the agent on a structured chart and return an analysis report. */
export async function runAnalysisAgent(chart: ChartResult): Promise<AnalysisReport> {
  return buildReport(chart);
}
