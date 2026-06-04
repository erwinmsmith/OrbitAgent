/**
 * ChartBrief — the structured "understanding material" document that
 * is auto-produced when a chart is cast. This is the input the LLM
 * gets on the FIRST LLM call of the analysis pipeline (Step 1:
 * understand). It is intentionally deterministic and human-readable so
 * the LLM can ground its reasoning in the actual chart fields, not
 * re-derive them.
 *
 * The brief is *also* the canonical machine-readable view of the
 * chart for the rest of the analysis pipeline. The RAG query planner
 * (Step 1) and the synthesizer (Step 2) both read it. It's exposed
 * via `divination.brief` and the `/divination/brief` route so the
 * caller can inspect it on its own.
 */
import type { ChartResult, ChartLine, HexagramMeta } from '../types/chart';

const TRIGRAM_NAME: Record<string, string> = {
  '乾': '乾天', '坤': '坤地', '震': '震雷', '巽': '巽风',
  '坎': '坎水', '离': '离火', '艮': '艮山', '兑': '兑泽',
};

export interface BriefLine {
  position: number;
  yinYang: '阴' | '阳';
  branch: string;
  stem: string;
  element: string;
  sixRelative: string;
  sixGod: string;
  moving: boolean;
  isShi: boolean;
  isYing: boolean;
  void: boolean;
  isYongshen: boolean;
  changedBranch?: string;
  changedElement?: string;
  strengthTags: string[];
}

export interface ChartBrief {
  question: string;
  questionType: string;
  time: {
    datetime?: string;
    solarTerm?: string;
    yearPillar?: string;
    monthPillar?: string;
    dayPillar?: string;
    hourPillar?: string;
    xunkong?: string[];
  };
  originalHexagram: {
    id: number;
    name: string;
    palace: string;
    palaceType: string;
    element: string;
    upper: string;
    lower: string;
  };
  changedHexagram: {
    id: number;
    name: string;
    palace: string;
    element: string;
  } | null;
  movingLines: number[];
  lines: BriefLine[];
  yongshen: {
    candidates: Array<{
      relative: string;
      positions: number[];
      reason: string;
      confidence: string;
    }>;
    supportingGods: Array<{ relative: string; positions: number[]; role: string }>;
    hostileGods: Array<{ relative: string; positions: number[]; role: string }>;
  };
  relations: {
    lineRelations: Array<{ source: string; target: string; type: string; description: string }>;
    dayRelations: Array<{ source: string; target: string; type: string; description: string }>;
  };
  transformations: Array<{
    position: number;
    fromBranch: string;
    toBranch: string;
    relation: string;
  }>;
  warnings: string[];
  /** Pre-rendered markdown-ish version of the brief — convenient for
   *  LLM prompts (chat models consume markdown better than JSON). */
  asMarkdown: string;
}

function formatHexagram(h: HexagramMeta): ChartBrief['originalHexagram'] {
  return {
    id: h.id,
    name: h.name,
    palace: h.palace,
    palaceType: h.palaceType,
    element: h.element,
    upper: TRIGRAM_NAME[h.upper] ?? h.upper,
    lower: TRIGRAM_NAME[h.lower] ?? h.lower,
  };
}

function formatLine(l: ChartLine): BriefLine {
  return {
    position: l.position,
    yinYang: l.yinYang,
    branch: l.branch,
    stem: l.stem,
    element: l.element,
    sixRelative: l.sixRelative,
    sixGod: l.sixGod,
    moving: l.moving,
    isShi: l.isShi,
    isYing: l.isYing,
    void: !!l.void,
    isYongshen: !!l.isYongshen,
    changedBranch: l.changedBranch,
    changedElement: l.changedElement,
    strengthTags: l.strength?.labels ?? [],
  };
}

/** Build the brief from a ChartResult. Pure function — no LLM, no IO. */
export function buildChartBrief(chart: ChartResult): ChartBrief {
  const t = chart.time ?? {};
  const orig = chart.originalHexagram;
  const chg = chart.changedHexagram;
  const lines = (chart.lines || []) as ChartLine[];

  const yongshen = chart.yongshen ?? { candidates: [], supportingGods: [], hostileGods: [] };
  const relations = chart.relations ?? { lineRelations: [], dayRelations: [] };

  const brief: ChartBrief = {
    question: chart.question ?? '',
    questionType: chart.questionType ?? '其他',
    time: {
      datetime: t.datetime,
      solarTerm: t.solarTerm,
      yearPillar: t.yearStem && t.yearBranch ? `${t.yearStem}${t.yearBranch}` : undefined,
      monthPillar: t.monthStem && t.monthBranch ? `${t.monthStem}${t.monthBranch}` : undefined,
      dayPillar: t.dayStem && t.dayBranch ? `${t.dayStem}${t.dayBranch}` : undefined,
      hourPillar: t.hourStem && t.hourBranch ? `${t.hourStem}${t.hourBranch}` : undefined,
      xunkong: t.xunkong ? [t.xunkong[0], t.xunkong[1]] : undefined,
    },
    originalHexagram: formatHexagram(orig),
    changedHexagram:
      chg && chg.name !== orig.name
        ? {
            id: chg.id,
            name: chg.name,
            palace: chg.palace,
            element: chg.element,
          }
        : null,
    movingLines: chart.movingLines ?? [],
    lines: lines.map(formatLine),
    yongshen: {
      candidates: (yongshen.candidates ?? []).map((c) => ({
        relative: c.relative,
        positions: c.positions,
        reason: c.reason,
        confidence: c.confidence,
      })),
      supportingGods: (yongshen.supportingGods ?? []).map((g) => ({
        relative: g.relative,
        positions: g.positions,
        role: g.role,
      })),
      hostileGods: (yongshen.hostileGods ?? []).map((g) => ({
        relative: g.relative,
        positions: g.positions,
        role: g.role,
      })),
    },
    relations: {
      lineRelations: (relations.lineRelations ?? []).map((r) => ({
        source: r.source,
        target: r.target,
        type: r.type,
        description: r.description,
      })),
      dayRelations: (relations.dayRelations ?? []).map((r) => ({
        source: r.source,
        target: r.target,
        type: r.type,
        description: r.description,
      })),
    },
    transformations: (chart.transformations ?? []).map((t) => ({
      position: t.position,
      fromBranch: t.fromBranch,
      toBranch: t.toBranch,
      relation: t.relation,
    })),
    warnings: chart.warnings ?? [],
    // asMarkdown is filled in below — keep it as a forward reference
    // so the brief object is JSON-serializable without recursion.
    asMarkdown: '',
  };
  brief.asMarkdown = renderBriefMarkdown(brief);
  return brief;
}

function renderBriefMarkdown(b: ChartBrief): string {
  const out: string[] = [];
  out.push('# 六爻排盘 Brief');
  if (b.question) out.push(`**用户问题**：${b.question}`);
  out.push(`**问题类型**：${b.questionType}`);

  out.push('\n## 起卦时间');
  if (b.time.datetime) out.push(`- 时间：${b.time.datetime}`);
  if (b.time.solarTerm) out.push(`- 节气：${b.time.solarTerm}`);
  const pillars = [
    b.time.yearPillar && `${b.time.yearPillar}年`,
    b.time.monthPillar && `${b.time.monthPillar}月`,
    b.time.dayPillar && `${b.time.dayPillar}日`,
    b.time.hourPillar && `${b.time.hourPillar}时`,
  ].filter(Boolean);
  if (pillars.length) out.push(`- 四柱：${pillars.join(' / ')}`);
  if (b.time.xunkong?.length) out.push(`- 旬空：${b.time.xunkong.join('、')}`);

  out.push('\n## 卦象');
  out.push(`- 本卦：**${b.originalHexagram.name}**（${b.originalHexagram.upper}上 / ${b.originalHexagram.lower}下），属${b.originalHexagram.palace}宫·${b.originalHexagram.palaceType}，五行${b.originalHexagram.element}`);
  if (b.changedHexagram) {
    out.push(`- 变卦：**${b.changedHexagram.name}**（属${b.changedHexagram.palace}宫，${b.changedHexagram.element}）`);
  } else {
    out.push(`- 变卦：本卦与变卦相同（无动爻）`);
  }
  out.push(`- 动爻：${b.movingLines.length ? b.movingLines.map((p) => `第${p}爻`).join('、') : '无'}`);

  out.push('\n## 六爻（六亲/六神/世应/空/动）');
  for (const l of b.lines) {
    const yx = l.yinYang === '阳' ? '—' : '--';
    const tags: string[] = [];
    if (l.isShi) tags.push('世');
    if (l.isYing) tags.push('应');
    if (l.void) tags.push('空');
    if (l.isYongshen) tags.push('用');
    const tagStr = tags.length ? ` 【${tags.join('/')}】` : '';
    const moveStr = l.moving ? ` 动→${l.changedBranch ?? '?'}(${l.changedElement ?? '?'})` : '';
    const strengthStr = l.strengthTags.length ? ` ${l.strengthTags.join('/')}` : '';
    out.push(`- 第${l.position}爻 ${yx} ${l.stem}${l.branch}(${l.element}) ${l.sixRelative} 临${l.sixGod}${tagStr}${moveStr}${strengthStr}`);
  }

  if (b.yongshen.candidates.length) {
    out.push('\n## 用神候选');
    for (const c of b.yongshen.candidates) {
      out.push(`- ${c.relative}（置信度：${c.confidence}）— 出现在第${c.positions.join('、')}爻；${c.reason}`);
    }
    if (b.yongshen.supportingGods.length) {
      out.push(`- 元神：${b.yongshen.supportingGods.map((g) => `${g.relative}(第${g.positions.join('、')}爻)`).join('、')}`);
    }
    if (b.yongshen.hostileGods.length) {
      out.push(`- 忌神/仇神：${b.yongshen.hostileGods.map((g) => `${g.relative}(第${g.positions.join('、')}爻)`).join('、')}`);
    }
  } else {
    out.push('\n## 用神候选');
    out.push('- 程序未给出用神候选（请根据问题类型与卦象自行判断）');
  }

  if (b.relations.lineRelations.length || b.relations.dayRelations.length) {
    out.push('\n## 地支关系');
    for (const r of b.relations.lineRelations) out.push(`- 爻位：${r.description}`);
    for (const r of b.relations.dayRelations) out.push(`- 与日辰：${r.description}`);
  }
  if (b.transformations.length) {
    out.push('\n## 动爻化出');
    for (const t of b.transformations) {
      out.push(`- 第${t.position}爻 ${t.fromBranch} → ${t.toBranch}（${t.relation}）`);
    }
  }
  if (b.warnings.length) {
    out.push('\n## 排盘警告');
    for (const w of b.warnings) out.push(`- ${w}`);
  }
  return out.join('\n');
}
