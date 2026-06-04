/**
 * Chart assembler — orchestrates the 13 skills (per design.md §6) and
 * produces the final ChartResult. Each skill that depends on a missing
 * hard-coded table will throw a TodoError; the assembler catches those
 * and records a `warnings[]` entry instead, so the rest of the chart
 * can still be built and the agent can still read the available data.
 */
import { castSkill } from './castSkill';
import { hexagramSkill } from './hexagramSkill';
import { palaceSkill } from './palaceSkill';
import { najiaSkill } from './najiaSkill';
import { sixRelativeSkill } from './sixRelativeSkill';
import { relativeOf } from '../constants/sixRelatives';
import { sixGodSkill } from './sixGodSkill';
import { voidSkill } from './voidSkill';
import { branchRelationSkill } from './branchRelationSkill';
import { transformationSkill } from './transformationSkill';
import { yongshenSkill } from './yongshenSkill';
import { strengthSkill } from './strengthSkill';
import { calendarSkill } from './calendarSkill';
import type {
  CastSkillOutput, HexagramSkillOutputT, PalaceSkillOutput, NaJiaSkillOutput,
  SixRelativeSkillOutput, SixGodSkillOutput, VoidSkillOutput,
  BranchRelationSkillOutput, TransformationSkillOutput, YongshenSkillOutput,
  StrengthSkillOutput, CalendarSkillOutput,
} from '../types/skill';
import type { ChartResult, ChartLine, HexagramMeta } from '../types/chart';
import type { QuestionType, EarthlyBranch, HeavenlyStem, LinePosition, WuXing, SixRelative, SixGod, YinYangBit } from '../types/basic';
import { flipYao, isMoving, yaoYinYang, LINE_POSITIONS } from '../constants/yao';
import { TRIGRAM_BITS, BITS_TO_TRIGRAM } from '../constants/trigrams';
import type { LinePosition as LP } from '../types/basic';

export interface AssembleInput {
  question?: string;
  questionType?: QuestionType;
  /** Six raw bits, one per line, bottom-to-top. 0=阴, 1=阳.
   *  Mutually exclusive with `yaoValues`. */
  bits?: [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1];
  /** Six raw 爻值 (6/7/8/9), one per line, bottom-to-top. Use this
   *  to feed moving lines (6/9) instead of the static-only bits mode. */
  yaoValues?: [6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9];
  /** Optional — pass when available. The MVP path requires this.
   *  If omitted AND `datetime` is supplied, derived from `datetime`. */
  dayStem?: HeavenlyStem;
  dayBranch?: EarthlyBranch;
  monthBranch?: EarthlyBranch;
  hourStem?: HeavenlyStem;
  hourBranch?: EarthlyBranch;
  /** ISO-8601 datetime string. If supplied + timezone, the calendar
   *  skill derives the 4 pillars automatically. Defaults to "now" if
   *  no dayStem is passed. */
  datetime?: string;
  timezone?: string;
}

/** Run the 13 skills in order, building a ChartResult. */
export function assembleChart(input: AssembleInput): ChartResult {
  const warnings: string[] = [];

  // Step 2 — Calendar (auto-derive dayStem/dayBranch/etc. when the
  // caller didn't supply them but did supply a datetime, or didn't
  // supply anything at all → use "now"). The user can still override
  // any field by passing it explicitly.
  let calendar: CalendarSkillOutput | null = null;
  if (!input.dayStem || !input.dayBranch) {
    const dt = input.datetime ? new Date(input.datetime) : new Date();
    if (isNaN(dt.getTime())) {
      warnings.push(`calendarSkill: invalid datetime "${input.datetime}", falling back to now`);
    } else {
      try {
        calendar = calendarSkill({ datetime: dt.toISOString(), timezone: input.timezone ?? '' });
        if (!input.dayStem)   input.dayStem   = calendar.dayStem;
        if (!input.dayBranch) input.dayBranch = calendar.dayBranch;
        if (!input.monthBranch) input.monthBranch = calendar.monthBranch;
        if (!input.hourStem)    input.hourStem  = calendar.hourStem;
        if (!input.hourBranch)  input.hourBranch = calendar.hourBranch;
      } catch (e: any) {
        warnings.push(`calendarSkill: ${e.message ?? e}`);
      }
    }
  }
  if (!input.dayStem || !input.dayBranch) {
    warnings.push('dayStem/dayBranch not derived (no datetime, no manual input) — sixGodSkill / voidSkill skipped');
  }

  // Step 3 — Casting
  const cast: CastSkillOutput = castSkill({
    bits: input.bits,
    yaoValues: input.yaoValues as any,
  });

  // Step 4 — Hexagram (graceful: empty HEXAGRAMS table → record warning
  // and continue with placeholder bits so the rest of the chart can still
  // be built and the agent can still read the available data).
  const hex: HexagramSkillOutputT = safe(() => hexagramSkill({ rawValues: cast.rawValues }),
                                          'hexagramSkill: HEXAGRAMS table empty',
                                          warnings) ?? {
    originalLines: [0,0,0,0,0,0] as any,
    changedLines:  [0,0,0,0,0,0] as any,
    originalHexagram: null,
    changedHexagram: null,
    movingLines: [],
  };
  if (!hex.originalHexagram) {
    warnings.push('originalHexagram could not be matched (HEXAGRAMS table empty)');
  }
  if (!hex.changedHexagram) {
    warnings.push('changedHexagram could not be matched (HEXAGRAMS table empty)');
  }

  // Step 5 — Palace
  let palace: PalaceSkillOutput | null = null;
  let shi: LP = 6, ying: LP = 3;
  if (hex.originalHexagram) {
    palace = safe(() => palaceSkill({ originalHexagramName: hex.originalHexagram!.name }),
                  'palaceSkill: HEXAGRAMS table empty',
                  warnings);
    if (palace) {
      shi = palace.shi;
      ying = palace.ying;
    }
  }

  // Step 6 — NaJia
  let najia: NaJiaSkillOutput | null = null;
  if (hex.originalHexagram) {
    najia = najiaSkill({
      lowerTrigram: hex.originalHexagram.lower,
      upperTrigram: hex.originalHexagram.upper,
    });
  }

  // Step 7 — Six Relative
  let relatives: SixRelative[] = ['兄弟','兄弟','兄弟','兄弟','兄弟','兄弟'];
  if (najia && palace) {
    const relOut: SixRelativeSkillOutput = sixRelativeSkill({
      palaceElement: palace.palaceElement,
      lineElements: najia.lines.map((l: any) => l.element) as any,
    });
    relatives = relOut.relatives;
  }

  // Step 8 — Six God
  let gods: SixGod[] = ['青龙','青龙','青龙','青龙','青龙','青龙'];
  if (input.dayStem) {
    const g: SixGodSkillOutput = sixGodSkill({ dayStem: input.dayStem });
    gods = g.gods;
  } else {
    warnings.push('dayStem not supplied — sixGodSkill skipped');
  }

  // Step 9 — Void
  let xunkong: [EarthlyBranch, EarthlyBranch] | undefined;
  let emptyLines: LP[] = [];
  if (input.dayStem && input.dayBranch && najia) {
    const v: VoidSkillOutput = safe(() => voidSkill({
      dayStem: input.dayStem!,
      dayBranch: input.dayBranch!,
      lineBranches: najia!.lines.map((l: any) => l.branch) as any,
    }), 'voidSkill: XUNKONG table empty', warnings) as any;
    if (v) {
      xunkong = v.xunkong;
      emptyLines = v.emptyLines;
    }
  }

  // Step 9.5 — 变卦 纳甲 + 六亲. After all moving lines flip, the
  // 变卦 has its own (upper, lower) trigram pair; re-running najiaSkill
  // on that pair gives the 变卦's stem/branch/element per line. The
  // 变卦's sixRelative is computed against the SAME palaceElement
  // (liuyao convention — 变爻's 六亲 uses 本卦宫's element, not the
  // 变卦's own palace's element). sixGod is unchanged because it
  // depends on dayStem only. For static charts (no moving lines),
  // the post-mutation bits match the original so the changed* fields
  // end up equal to the original.
  let changedLinesNajia: NaJiaSkillOutput['lines'] | null = null;
  if (hex.originalLines && hex.originalHexagram) {
    const changedBits: YinYangBit[] = hex.originalLines.map((b, i) => {
      const pos = (i + 1) as LinePosition;
      if (hex.movingLines.includes(pos)) return b === 1 ? 0 : 1;
      return b;
    });
    const upperBits = changedBits.slice(3).join('');
    const lowerBits = changedBits.slice(0, 3).join('');
    const newUpper = BITS_TO_TRIGRAM[upperBits];
    const newLower = BITS_TO_TRIGRAM[lowerBits];
    if (newUpper && newLower) {
      changedLinesNajia = najiaSkill({
        lowerTrigram: newLower,
        upperTrigram: newUpper,
      }).lines;
    }
  }

  // Build the 6 ChartLine objects (positions 1..6).
  const lines = ((): ChartLine[] => {
    const out: ChartLine[] = [];
    for (let i = 0; i < 6; i++) {
      const position = LINE_POSITIONS[i]!;
      const rawValue = cast.rawValues[i]!;
      const moving = isMoving(rawValue);
      const yinyang = yaoYinYang(rawValue);
      const changedYinYang = moving ? yaoYinYang(flipYao(rawValue)) : yinyang;
      const isShi = position === shi;
      const isYing = position === ying;
      // 变卦 纳甲 from the post-mutation bit pattern (defaults to
      // the original 纳甲 if we couldn't compute the post-mutation
      // trigram pair).
      const cn = changedLinesNajia?.[i];
      const line: ChartLine = {
        position,
        rawValue,
        yinYang: yinyang,
        moving,
        changedYinYang,
        stem: (najia?.lines[i]?.stem ?? '甲') as any,
        branch: (najia?.lines[i]?.branch ?? '子') as any,
        element: (najia?.lines[i]?.element ?? '水') as any,
        sixRelative: relatives[i]!,
        sixGod: gods[i]!,
        isShi,
        isYing,
        void: emptyLines.includes(position),
        // 变卦 fields — same shape, recomputed against the post-mutation
        // 纳甲. sixRel uses the original palaceElement (liuyao rule).
        changedStem: cn?.stem as any,
        changedBranch: cn?.branch as any,
        changedElement: cn?.element as any,
        changedSixRelative: palace && cn
          ? relativeOf(palace.palaceElement, cn.element)
          : undefined,
      };
      out.push(line);
    }
    return out;
  })();

  // Step 10 — Branch relations
  let relations: ChartResult['relations'];
  const brOut: BranchRelationSkillOutput | null = safe(() => branchRelationSkill({
    lines,
    dayBranch: input.dayBranch,
    monthBranch: input.monthBranch,
  }), 'branchRelationSkill', warnings);
  if (brOut) relations = { lineRelations: brOut.relations };

  // Step 11 — Transformations
  const transformations: ChartResult['transformations'] = [];
  if (hex.changedHexagram && najia) {
    for (const pos of hex.movingLines) {
      const originalLine = lines.find((l) => l.position === pos);
      const flippedBits = [...hex.originalLines];
      // For the "changedLine" we re-run hex+ najia on the post-mutation
      // bit pattern for this position only. The chart assembler
      // shortcuts: originalLine + original bits → new bits at moving
      // positions.
      const changedBits = [...hex.originalLines];
      // Flip bit at this position (1-indexed).
      changedBits[pos - 1] = changedBits[pos - 1] === 1 ? 0 : 1;
      // Build a "changed version" of this line by re-deriving its
      // 纳甲 — the changed line's branch comes from the *changed*
      // trigram pair.
      const upperBits = changedBits.slice(3).join('');
      const lowerBits = changedBits.slice(0, 3).join('');
      const newUpper = BITS_TO_TRIGRAM[upperBits];
      const newLower = BITS_TO_TRIGRAM[lowerBits];
      if (newUpper && newLower && originalLine) {
        const newNajia = najiaSkill({ lowerTrigram: newLower, upperTrigram: newUpper });
        const newLine: ChartLine = {
          ...originalLine,
          branch: newNajia.lines[pos - 1]!.branch as any,
          element: newNajia.lines[pos - 1]!.element as any,
          changedYinYang: flippedBits[pos - 1] === 1 ? '阳' : '阴',
        };
        const t: TransformationSkillOutput = safe(() => transformationSkill({
          originalLine,
          changedLine: newLine,
        }), 'transformationSkill', warnings) as any;
        if (t) transformations.push(t);
      }
    }
  }

  // Step 12 — Yongshen (only meaningful if we have a chart)
  const partialChart: ChartResult = {
    question: input.question,
    questionType: input.questionType,
    input: { type: 'coins', raw: input.yaoValues ?? input.bits },
    // Time block: populated when we ran the calendar skill (which
    // derives the 4 pillars from a solar datetime). When the caller
    // passed dayStem/dayBranch manually but no datetime, we still
    // fill in year/month from the current time + day from the
    // caller's input.
    time: calendar ? {
      datetime: input.datetime ?? new Date().toISOString(),
      timezone: input.timezone,
      yearStem:   calendar.yearStem,
      yearBranch: calendar.yearBranch,
      monthStem:  calendar.monthStem,
      monthBranch: calendar.monthBranch,
      dayStem:    calendar.dayStem,
      dayBranch:  calendar.dayBranch,
      hourStem:   calendar.hourStem,
      hourBranch: calendar.hourBranch,
      xunkong:    calendar.xunkong,
      solarTerm:  calendar.solarTerm,
    } : (input.datetime ? { datetime: input.datetime, timezone: input.timezone } : undefined),
    originalHexagram: (hex.originalHexagram ?? {
      id: 0, name: '?', upper: '乾', lower: '乾', palace: '乾宫',
      palaceType: '本宫', element: '金',
    }) as HexagramMeta,
    changedHexagram: (hex.changedHexagram ?? hex.originalHexagram ?? {
      id: 0, name: '?', upper: '乾', lower: '乾', palace: '乾宫',
      palaceType: '本宫', element: '金',
    }) as HexagramMeta,
    movingLines: hex.movingLines,
    lines: lines as [ChartLine, ChartLine, ChartLine, ChartLine, ChartLine, ChartLine],
    relations,
    transformations,
    summaryTags: [],
  };

  let yongshen;
  if (input.question) {
    const y: YongshenSkillOutput | null = safe(() => yongshenSkill({
      question: input.question!,
      questionType: input.questionType,
      chart: partialChart,
    }), 'yongshenSkill', warnings);
    if (y) yongshen = { candidates: y.candidates };
  }

  return {
    ...partialChart,
    yongshen,
    warnings: warnings.length ? warnings : undefined,
  };
}

/** Run a skill; on TodoError, log a warning and return null. */
function safe<T>(fn: () => T, label: string, warnings: string[]): T | null {
  try {
    return fn();
  } catch (e: any) {
    warnings.push(`${label}: ${e.message ?? e}`);
    return null;
  }
}
