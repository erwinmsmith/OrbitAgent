/**
 * `divination` tool — the only callable tool the 六爻 agent needs.
 *
 * New design (per the user's flow change):
 *   - The user runs `orbit divination chart <bits>` first. The chart
 *     is persisted to ChartStore under the sessionId.
 *   - The agent is then invoked on that session. It sees the chart's
 *     summary injected as system context, and it calls THIS tool with
 *     `action: "analyze"` to get the full 6/9-section report.
 *   - There is no `cast` or `chart` action in the tool schema — those
 *     are CLI concerns, not agent concerns. The agent reads the
 *     already-stored chart.
 *
 * The tool receives the `sessionId` via a `boundSessionId` field set
 * by /chat before the tool is called (we attach it in chat.routes).
 * This avoids the LLM having to know sessionId in its tool call.
 */
import { ToolDefinition, ToolParams } from '../types';
import { getChart } from '../../../core/memory/ChartStore';
import { runAnalysisAgent } from '../../../liuyao/agent/analysisAgent';

export default class DivinationTool {
  readonly id = 'divination';
  readonly name = 'divination';
  readonly description =
    '六爻 analysis step. ONLY one action: `analyze`. ' +
    'Reads the chart the user previously cast (via `orbit divination chart`) ' +
    'from the server-side ChartStore and returns a structured 6-section ' +
    'AnalysisReport with RAG citations. ' +
    'The agent MUST use this when the user asks for an interpretation — ' +
    'never recompute 本卦/变卦/纳甲/六亲/六神 itself.';
  readonly schema: ToolDefinition = {
    name: 'divination',
    description: this.description,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['analyze'],
          description: 'Only "analyze" is supported; the chart was already cast by the user.',
        },
      },
      required: ['action'],
    },
  };

  /**
   * Bound sessionId — set by /chat before each tool call. This is the
   * session whose stored chart we read. We don't expose it in the
   * tool's inputSchema so the LLM never has to think about sessions.
   */
  private boundSessionId: string | null = null;

  setBoundSessionId(sessionId: string): void { this.boundSessionId = sessionId; }
  getBoundSessionId(): string | null { return this.boundSessionId; }

  async execute(params: ToolParams): Promise<any> {
    if (params.action !== 'analyze') {
      throw new Error(`divination tool only supports action=analyze, got: ${params.action}`);
    }
    if (!this.boundSessionId) {
      throw new Error('divination tool: no sessionId bound. /chat must set it before each call.');
    }
    const stored = await getChart(this.boundSessionId);
    if (!stored) {
      throw new Error(
        `No stored chart for sessionId=${this.boundSessionId}. ` +
        'The user must run `orbit divination chart <bits> --session <id>` first.',
      );
    }
    return runAnalysisAgent(stored.chart);
  }

  protected async run(params: ToolParams): Promise<any> {
    return this.execute(params);
  }
}
