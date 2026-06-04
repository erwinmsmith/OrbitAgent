/**
 * `divination` tool — the only callable tool the 六爻 agent needs.
 *
 * Two actions:
 *   - `analyze`: reads the chart the user previously cast (via
 *     `orbit divination chart`) from the server-side ChartStore and
 *     returns a structured 6/9-section AnalysisReport with RAG
 *     citations.
 *   - `rag-search`: looks up domain knowledge from the 智谱
 *     Embedding-3-backed RAG corpus (装卦方法/六爻卦理/实例应用/
 *     精华荟萃/etc.). Use this to cite a source when explaining a
 *     concept that is not in the LLM's own training data, e.g.
 *     "回头生克" or "动化进退" or 黄金策 quote.
 *
 * Flow:
 *   - The user runs `orbit divination chart <bits> --session <id>`
 *     once. The chart is persisted to ChartStore (Mongo) under
 *     (userId, sessionId, chartKey).
 *   - The agent is then invoked on that session. /chat injects a
 *     short chart pointer into the system prompt and binds
 *     (userId, sessionId) to this tool. The LLM calls
 *     `divination.analyze` for the full report and
 *     `divination.rag-search` for domain citations — without ever
 *     having to decide a sessionId.
 *
 * Per-user isolation: the chart read is scoped by boundUserId, so
 * the LLM (or a malicious /chat caller) cannot probe other users'
 * stored charts by guessing a sessionId. RAG searches are also
 * scoped by userId (system-scope + the caller's own user-scope
 * uploads).
 */
import { ToolDefinition, ToolParams } from '../types';
import { getChart } from '../../../core/memory/ChartStore';
import { runAnalysisAgent } from '../../../liuyao/agent/analysisAgent';
import { search as ragSearch } from '../../../liuyao/rag';

export default class DivinationTool {
  readonly id = 'divination';
  readonly name = 'divination';
  readonly description =
    '六爻 tool for the agent. Two actions:\n' +
    '1. action="analyze": reads the chart the user previously cast ' +
    '(via `orbit divination chart`) from the server-side ChartStore ' +
    'and returns a structured 6/9-section AnalysisReport with RAG ' +
    'citations.\n' +
    '2. action="rag-search": looks up domain knowledge from the ' +
    '智谱-Embedding-3-backed RAG corpus (装卦方法 / 六爻卦理 / ' +
    '实例应用 / 精华荟萃 / 黄金策 / 增删卜易 / etc.). Pass a ' +
    'natural-language query and a `k` (default 4); the top-k chunks ' +
    'come back with their source file, section title, and a snippet.\n' +
    'Use both: call `analyze` once for the full report, then call ' +
    '`rag-search` whenever you need to cite a specific concept.';
  readonly schema: ToolDefinition = {
    name: 'divination',
    description: this.description,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['analyze', 'rag-search'],
          description: '`analyze` returns the full chart interpretation; `rag-search` looks up a concept in the RAG corpus.',
        },
        query: {
          type: 'string',
          description: 'Required for action=rag-search. Natural-language query, e.g. "回头生克" or "妻财持世".',
        },
        k: {
          type: 'number',
          description: 'Top-k chunks to return for action=rag-search. Default 4.',
          default: 4,
        },
      },
      required: ['action'],
    },
  };

  private boundSessionId: string | null = null;
  private boundUserId: string | null = null;
  private boundIsAdmin: boolean = false;

  setBoundSession(sessionId: string, userId: string, isAdmin: boolean = false): void {
    this.boundSessionId = sessionId;
    this.boundUserId = userId;
    this.boundIsAdmin = isAdmin;
  }
  setBoundSessionId(sessionId: string): void {
    this.boundSessionId = sessionId;
  }
  getBoundSessionId(): string | null { return this.boundSessionId; }

  async execute(params: ToolParams): Promise<any> {
    if (params.action === 'analyze') {
      if (!this.boundSessionId || !this.boundUserId) {
        throw new Error('divination tool: no (userId, sessionId) bound. /chat must set it before each call.');
      }
      const stored = await getChart(this.boundUserId, this.boundSessionId);
      return runAnalysisAgent(stored.chart, this.boundUserId, this.boundIsAdmin);
    }
    if (params.action === 'rag-search') {
      const q = (params.query ?? '').toString().trim();
      if (!q) {
        throw new Error('divination.rag-search: `query` is required');
      }
      if (!this.boundUserId) {
        throw new Error('divination tool: no userId bound. /chat must set it before each call.');
      }
      const k = Math.max(1, Math.min(20, parseInt(String(params.k ?? 4), 10) || 4));
      const hits = await ragSearch(q, k, this.boundUserId, this.boundIsAdmin);
      return hits.map(({ chunk, score }) => ({
        source: chunk.source,
        title: chunk.title,
        snippet: chunk.text.slice(0, 200),
        score,
      }));
    }
    throw new Error(`divination tool: unknown action "${params.action}"`);
  }

  protected async run(params: ToolParams): Promise<any> {
    return this.execute(params);
  }
}
