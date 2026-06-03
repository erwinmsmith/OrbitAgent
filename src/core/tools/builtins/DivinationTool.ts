/**
 * `divination` tool — the only callable tool the 六爻 agent needs.
 *
 * Flow:
 *   - The user runs `orbit divination chart <bits> --session <id>` once.
 *     The chart is persisted to ChartStore (Mongo) under
 *     (userId, sessionId, chartKey).
 *   - The agent is then invoked on that session. /chat injects a chart
 *     summary as a system message, and binds (userId, sessionId) to
 *     this tool. The LLM calls this tool with action=analyze and
 *     gets back the full 6/9-section report — without ever seeing
 *     the raw bits or having to decide a sessionId.
 *   - There is no `cast` or `chart` action in the tool schema. Those
 *     are CLI concerns, not agent concerns. The agent reads the
 *     already-stored chart.
 *
 * Per-user isolation: the tool's read is scoped by boundUserId, so
 * the LLM (or a malicious /chat caller) cannot probe other users'
 * stored charts by guessing a sessionId.
 */
import { ToolDefinition, ToolParams } from '../types';
import { getChart } from '../../../core/memory/ChartStore';
import { runAnalysisAgent } from '../../../liuyao/agent/analysisAgent';

export default class DivinationTool {
  readonly id = 'divination';
  readonly name = 'divination';
  readonly description =
    '六爻 analysis step. ONE action: `analyze`. ' +
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
   * Bound (userId, sessionId, isAdmin) — set by /chat before each
   * tool call. The userId scopes both the chart read AND the RAG
   * citations in the rendered report; the sessionId selects the
   * chart; isAdmin widens the RAG visibility for admin users.
   * None of these are exposed in the tool's inputSchema so the LLM
   * never has to think about any of them.
   */
  private boundSessionId: string | null = null;
  private boundUserId: string | null = null;
  private boundIsAdmin: boolean = false;

  setBoundSession(sessionId: string, userId: string, isAdmin: boolean = false): void {
    this.boundSessionId = sessionId;
    this.boundUserId = userId;
    this.boundIsAdmin = isAdmin;
  }
  /** Back-compat shim — older call sites only set sessionId. */
  setBoundSessionId(sessionId: string): void {
    this.boundSessionId = sessionId;
  }
  getBoundSessionId(): string | null { return this.boundSessionId; }

  async execute(params: ToolParams): Promise<any> {
    if (params.action !== 'analyze') {
      throw new Error(`divination tool only supports action=analyze, got: ${params.action}`);
    }
    if (!this.boundSessionId || !this.boundUserId) {
      throw new Error('divination tool: no (userId, sessionId) bound. /chat must set it before each call.');
    }
    const stored = await getChart(this.boundUserId, this.boundSessionId);
    return runAnalysisAgent(stored.chart, this.boundUserId, this.boundIsAdmin);
  }

  protected async run(params: ToolParams): Promise<any> {
    return this.execute(params);
  }
}
