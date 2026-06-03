/**
 * Input / output contracts for each deterministic skill. These mirror
 * design.md §5 exactly.
 */
import type {
  EarthlyBranch, HeavenlyStem, LinePosition, WuXing, SixRelative, SixGod,
  YaoValue, QuestionType, Trigram,
} from './basic';
import type { ChartLine, ChartResult, HexagramMeta, CastResult, HexagramSkillOutput } from './chart';

// Re-export for ergonomic imports in the skills themselves.
export type { ChartResult, CastResult, HexagramSkillOutput, ChartLine, HexagramMeta };

// ─── 5.1 Casting Skill ────────────────────────────────────────────────
export interface CastSkillInput {
  /**
   * 6 raw bits, one per line, bottom-to-top. The default input mode
   * for the CLI's `0 1 1 0 1 1`. Static — 0=阴(8), 1=阳(7); no
   * moving lines.
   */
  bits?: [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1];
  /**
   * 6 explicit 爻值 (6/7/8/9), one per line, bottom-to-top. Use this
   * when you want to feed moving lines (6 = 老阴, 9 = 老阳) instead
   * of the static-only bits mode. Mutually exclusive with `bits`.
   */
  yaoValues?: [YaoValue, YaoValue, YaoValue, YaoValue, YaoValue, YaoValue];
  /**
   * @deprecated  Use `bits` for manual input or `yaoValues` for raw
   *  爻值. Kept for backward compatibility — `manual` means use
   *  `bits`; `coin` is no longer supported here (use
   *  threeCoinsToYaoValue() at the CLI layer to derive yaoValues).
   */
  interpretation?: 'manual' | 'coin';
}
export type CastSkillOutput = CastResult;

// ─── 5.2 Hexagram Skill ──────────────────────────────────────────────
export interface HexagramSkillInput {
  rawValues: [YaoValue, YaoValue, YaoValue, YaoValue, YaoValue, YaoValue];
}
export type HexagramSkillOutputT = HexagramSkillOutput;

// ─── 5.3 Palace Skill ─────────────────────────────────────────────────
export interface PalaceSkillInput {
  originalHexagramName: string;
}
export interface PalaceSkillOutput {
  palace: Trigram;            // the palace trigram (e.g. '乾' for 乾宫)
  palaceElement: WuXing;
  palaceType: '本宫' | '一世' | '二世' | '三世' | '四世' | '五世' | '游魂' | '归魂';
  shi: LinePosition;
  ying: LinePosition;
}

// ─── 5.4 NaJia Skill ──────────────────────────────────────────────────
export interface NaJiaSkillInput {
  lowerTrigram: Trigram;
  upperTrigram: Trigram;
}
export interface NaJiaLine {
  position: LinePosition;
  stem: HeavenlyStem;
  branch: EarthlyBranch;
  element: WuXing;
}
export interface NaJiaSkillOutput {
  lines: [NaJiaLine, NaJiaLine, NaJiaLine, NaJiaLine, NaJiaLine, NaJiaLine];
}

// ─── 5.5 Six Relative Skill ───────────────────────────────────────────
export interface SixRelativeSkillInput {
  palaceElement: WuXing;
  lineElements: [WuXing, WuXing, WuXing, WuXing, WuXing, WuXing];
}
export interface SixRelativeSkillOutput {
  relatives: [SixRelative, SixRelative, SixRelative, SixRelative, SixRelative, SixRelative];
}

// ─── 5.6 Six God Skill ───────────────────────────────────────────────
export interface SixGodSkillInput {
  dayStem: HeavenlyStem;
}
export interface SixGodSkillOutput {
  gods: [SixGod, SixGod, SixGod, SixGod, SixGod, SixGod];
}

// ─── 5.7 Calendar Skill ──────────────────────────────────────────────
export interface CalendarSkillInput {
  /** ISO-8601 datetime string. */
  datetime: string;
  /** IANA timezone name. */
  timezone: string;
}
export interface CalendarSkillOutput {
  yearStem: HeavenlyStem;
  yearBranch: EarthlyBranch;
  monthStem: HeavenlyStem;
  monthBranch: EarthlyBranch;
  dayStem: HeavenlyStem;
  dayBranch: EarthlyBranch;
  hourStem?: HeavenlyStem;
  hourBranch?: EarthlyBranch;
  xunkong: [EarthlyBranch, EarthlyBranch];
  solarTerm?: string;
}

// ─── 5.8 Branch Relation Skill ────────────────────────────────────────
export interface BranchRelationSkillInput {
  lines: ChartLine[];
  dayBranch?: EarthlyBranch;
  monthBranch?: EarthlyBranch;
}
export interface BranchRelation {
  source: string;
  target: string;
  type: '冲' | '合' | '刑' | '害' | '破' | '三合' | '半三合';
  description: string;
}
export interface BranchRelationSkillOutput {
  relations: BranchRelation[];
}

// ─── 5.9 Void Skill ──────────────────────────────────────────────────
export interface VoidSkillInput {
  dayStem: HeavenlyStem;
  dayBranch: EarthlyBranch;
  lineBranches: [EarthlyBranch, EarthlyBranch, EarthlyBranch, EarthlyBranch, EarthlyBranch, EarthlyBranch];
}
export interface VoidSkillOutput {
  xunkong: [EarthlyBranch, EarthlyBranch];
  emptyLines: LinePosition[];
}

// ─── 5.10 Strength Skill ──────────────────────────────────────────────
export interface StrengthSkillInput {
  lines: ChartLine[];
  monthBranch?: EarthlyBranch;
  dayBranch?: EarthlyBranch;
}
export type LineStrengthLabel =
  | '旺' | '相' | '休' | '囚' | '死' | '月破' | '日破' | '旬空'
  | '得日生' | '得月生' | '得日扶' | '得月扶' | '被日克' | '被月克';
export interface LineStrength {
  position: LinePosition;
  labels: LineStrengthLabel[];
  score?: number;
}
export interface StrengthSkillOutput {
  lineStrengths: LineStrength[];
}

// ─── 5.11 Yongshen Skill ──────────────────────────────────────────────
export interface YongshenSkillInput {
  question: string;
  questionType?: QuestionType;
  chart: ChartResult;
}
export interface YongshenCandidateT {
  relative: SixRelative;
  positions: LinePosition[];
  reason: string;
  confidence: 'low' | 'medium' | 'high';
}
export interface YongshenSkillOutput {
  candidates: YongshenCandidateT[];
}

// ─── 5.12 Transformation Skill ────────────────────────────────────────
export interface TransformationSkillInput {
  originalLine: ChartLine;
  changedLine: ChartLine;
}
export interface TransformationSkillOutput {
  position: LinePosition;
  fromBranch: EarthlyBranch;
  toBranch: EarthlyBranch;
  fromElement: WuXing;
  toElement: WuXing;
  relation: '化生' | '化克' | '回头生' | '回头克' | '化进' | '化退' | '化空' | '化破' | '普通变化';
}

// ─── 5.13 FuShen Skill (P2 — optional) ────────────────────────────────
export interface FuShenSkillInput {
  originalHexagram: HexagramMeta;
  palacePureHexagram: HexagramMeta;
  visibleRelatives: SixRelative[];
}
export interface FuShenItem {
  relative: SixRelative;
  fushenBranch: EarthlyBranch;
  feishenBranch: EarthlyBranch;
  position: LinePosition;
}
export interface FuShenSkillOutput {
  hiddenGods: FuShenItem[];
}

// ─── Skill function type alias ─────────────────────────────────────────
export type Skill<I, O> = (input: I) => Promise<O> | O;
