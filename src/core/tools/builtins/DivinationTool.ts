/**
 * `divination` tool — the only callable tool the 六爻 agent needs.
 *
 * Three actions:
 *   - `inspect`: reads the chart from ChartStore and returns the
 *      structured ChartBrief (本卦/变卦/动爻/世应/用神/排盘警告 等).
 *      The LLM can use this to re-read the deterministic material
 *      without re-running the full analysis pipeline.
 *   - `analyze`: runs the full multi-stage analysis pipeline
 *      (build brief → LLM #1 understand → RAG retrieve → LLM #2
 *      synthesize). Returns the final report + the full debug
 *      timeline so the chat route can surface it to the caller.
 *   - `rag-search`: looks up domain knowledge from the RAG corpus.
 *      Use this when the LLM wants a specific concept it didn't get
 *      from the analyze pipeline's auto-queries.
 *
 * Per-user isolation: every read is scoped by boundUserId, so the
 * LLM (or a malicious /chat caller) cannot probe other users'
 * stored charts by guessing a sessionId. RAG searches are also
 * scoped by userId (system-scope + the caller's own user-scope
 * uploads).
 */
import { ToolDefinition, ToolParams } from '../types';
import { getChart } from '../../../core/memory/ChartStore';
import { runAnalysisAgent } from '../../../liuyao/agent/analysisAgent';
import { buildChartBrief } from '../../../liuyao/agent/chartBrief';
import { search as ragSearch } from '../../../liuyao/rag';

export default class DivinationTool {
  readonly id = 'divination';
  readonly name = 'divination';
  readonly description =
    '六爻 tool for the agent. Three actions:\n' +
    '1. action="inspect": reads the chart previously cast and returns a structured ' +
    'ChartBrief (本卦/变卦/动爻/世应/用神/排盘警告). Use this to re-read deterministic material.\n' +
    '2. action="analyze": runs the full multi-stage pipeline (build brief → LLM #1 understand → ' +
    'RAG retrieve → LLM #2 synthesize) and returns the final report + debug timeline.\n' +
    '3. action="rag-search": looks up domain knowledge from the RAG corpus ' +
    '(装卦方法 / 六爻卦理 / 实例应用 / 精华荟萃 / 黄金策 / 增删卜易 / etc.). ' +
    'Pass a natural-language query and a `k` (default 4).\n' +
    'Use "analyze" for the full report; use "rag-search" when you need to cite a specific ' +
    'concept that the analyze pipeline did not retrieve.';
  readonly schema: ToolDefinition = {
    name: 'divination',
    description: this.description,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['inspect', 'analyze', 'rag-search'],
          description: '`inspect` returns the ChartBrief; `analyze` runs the full pipeline; `rag-search` looks up a concept in the RAG corpus.',
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
        debug: {
          type: 'boolean',
          description: 'For action=analyze: include the full pipeline timeline (every LLM call, RAG query, hit). Default true so the chat route can surface it.',
          default: true,
        },
        thinking: {
          type: 'boolean',
          description: 'For action=analyze: enable multi-angle thinking mode. The pipeline runs the LLM once per angle in parallel, each angle doing its own RAG retrieval, then a final synthesis step merges all per-angle analyses. Slower and costs more tokens than the default 3-stage pipeline, but produces a more thorough report.',
          default: false,
        },
        angles: {
          type: 'number',
          description: 'For action=analyze with thinking=true: how many independent angles to investigate in parallel. Default 3, max 5. The Stage-1 LLM plans the angles; if it returns fewer, the pipeline pads with the standard defaults (用神/世应/时间/古断).',
          default: 3,
        },
      },
      required: ['action'],
    },
  };

  private boundSessionId: string | null = null;
  private boundUserId: string | null = null;
  private boundIsAdmin: boolean = false;
  /** Model the LLM should use. /chat sets this from the agent's
   *  config so the analyze LLM calls go to the right provider. */
  private boundModel: string | null = null;

  setBoundSession(sessionId: string, userId: string, isAdmin: boolean = false, model?: string): void {
    this.boundSessionId = sessionId;
    this.boundUserId = userId;
    this.boundIsAdmin = isAdmin;
    if (model) this.boundModel = model;
  }
  setBoundSessionId(sessionId: string): void {
    this.boundSessionId = sessionId;
  }
  getBoundSessionId(): string | null { return this.boundSessionId; }

  async execute(params: ToolParams): Promise<any> {
    if (params.action === 'inspect') {
      if (!this.boundSessionId || !this.boundUserId) {
        throw new Error('divination tool: no (userId, sessionId) bound. /chat must set it before each call.');
      }
      const stored = await getChart(this.boundUserId, this.boundSessionId);
      return buildChartBrief(stored.chart);
    }
    if (params.action === 'analyze') {
      if (!this.boundSessionId || !this.boundUserId) {
        throw new Error('divination tool: no (userId, sessionId) bound. /chat must set it before each call.');
      }
      const stored = await getChart(this.boundUserId, this.boundSessionId);
      const includeDebug = params.debug !== false; // default true
      const thinking = params.thinking === true;
      // Clamp angles into [1, 5] with a default of 3.
      const rawAngles = Number(params.angles);
      const angles = Number.isFinite(rawAngles)
        ? Math.max(1, Math.min(5, Math.floor(rawAngles)))
        : 3;
      const result = await runAnalysisAgent(stored.chart, this.boundUserId, this.boundIsAdmin, {
        model: this.boundModel ?? undefined,
        debug: includeDebug,
        thinking,
        angles,
      });
      return result;
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
