/**
 * `divination` tool — the only callable tool the 六爻 agent should
 * have. Wraps the deterministic engine (castSkill, chartAssembler,
 * runAnalysisAgent) and exposes it as a single tool the LLM can pick.
 *
 * Schema is intentionally narrow: the agent passes six raw bits
 * (0/1) and the tool returns either a CastResult, ChartResult, or
 * full AnalysisReport depending on the `action` field.
 */
import { ToolDefinition, ToolParams, ToolResult } from '../types';
import { castSkill } from '../../../liuyao/skills/castSkill';
import { assembleChart, type AssembleInput } from '../../../liuyao/skills/chartAssembler';
import { runAnalysisAgent } from '../../../liuyao/agent/analysisAgent';

export default class DivinationTool {
  readonly id = 'divination';
  readonly name = 'divination';
  readonly description =
    '六爻 deterministic engine. Three actions: ' +
    '`cast` (6 bits → CastResult), `chart` (bits + day pillar + question → ChartResult + warnings), ' +
    '`analyze` (ChartResult → 6-section AnalysisReport with RAG citations). ' +
    'The agent MUST use this tool for any 排盘/装卦/六亲 work; never recompute it.';
  readonly schema: ToolDefinition = {
    name: 'divination',
    description: this.description,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['cast', 'chart', 'analyze'],
          description: 'Which engine step to invoke',
        },
        bits: {
          type: 'array',
          items: { type: 'integer', enum: [0, 1] },
          minItems: 6,
          maxItems: 6,
          description: 'Six raw bits, bottom-to-top: 0=阴, 1=阳. Required for cast and chart.',
        },
        question: {
          type: 'string',
          description: 'User question text. Optional for chart, ignored by cast.',
        },
        questionType: {
          type: 'string',
          enum: ['求财', '求事业', '求感情', '求考试', '求合同', '求健康',
                  '求失物', '求出行', '求合作', '求官司', '求宠物', '其他'],
          description: 'Override the engine\'s question-type detection.',
        },
        dayStem:   { type: 'string', description: '日干 (e.g. 甲) — needed for 六神 + 旬空' },
        dayBranch: { type: 'string', description: '日支 (e.g. 子) — needed for 旬空 + 冲合' },
        monthBranch:{ type: 'string', description: '月支 (e.g. 寅) — needed for 月破 + 旺衰' },
        chart: {
          type: 'object',
          description: 'A previously-computed ChartResult. Required for action=analyze.',
        },
      },
      required: ['action'],
    },
  };

  async execute(params: ToolParams): Promise<any> {
    return this.run(params);
  }

  protected async run(params: ToolParams): Promise<any> {
    const { action, bits, question, questionType, dayStem, dayBranch, monthBranch, chart } = params as {
      action: 'cast' | 'chart' | 'analyze';
      bits?: number[];
      question?: string;
      questionType?: any;
      dayStem?: any;
      dayBranch?: any;
      monthBranch?: any;
      chart?: any;
    };

    if (action === 'cast') {
      if (!Array.isArray(bits) || bits.length !== 6) {
        throw new Error('divination cast requires bits (array of 6 × 0|1)');
      }
      return castSkill({ bits: bits as any });
    }

    if (action === 'chart') {
      if (!Array.isArray(bits) || bits.length !== 6) {
        throw new Error('divination chart requires bits (array of 6 × 0|1)');
      }
      const input: AssembleInput = {
        bits: bits as any,
        question,
        questionType,
        dayStem: dayStem as any,
        dayBranch: dayBranch as any,
        monthBranch: monthBranch as any,
      };
      return assembleChart(input);
    }

    if (action === 'analyze') {
      if (!chart || typeof chart !== 'object') {
        throw new Error('divination analyze requires a chart object');
      }
      return runAnalysisAgent(chart);
    }

    throw new Error(`unknown divination action: ${action}`);
  }
}
