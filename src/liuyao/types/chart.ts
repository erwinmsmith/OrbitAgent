/**
 * Structured output types for the casting pipeline. The Agent must only
 * READ these — it is not allowed to recompute any field, only interpret.
 *
 * Faithful to `design.md` §10-§11.
 */
import type {
  EarthlyBranch, HeavenlyStem, WuXing, Trigram, SixGod, SixRelative,
  Palace, PalaceType, LinePosition, YaoValue, YinYang, YinYangBit,
  QuestionType, BranchRelationType,
} from './basic';

/** A single line in a hexagram chart, with all its decorations. */
export interface ChartLine {
  position: LinePosition;     // 1=初爻 (bottom) … 6=上爻 (top)
  rawValue: YaoValue;          // 6/7/8/9 from the coin throws
  yinYang: YinYang;            // 6/8=阴, 7/9=阳
  moving: boolean;             // true for 6 (old-yin) and 9 (old-yang)
  changedYinYang: YinYang;     // yin/yang after flipping moving lines
  stem: HeavenlyStem;
  branch: EarthlyBranch;
  element: WuXing;
  sixRelative: SixRelative;
  sixGod: SixGod;
  isShi: boolean;              // is this the world line (世爻)?
  isYing: boolean;             // is this the response line (应爻)?
  isYongshen?: boolean;        // is this the target/use god (用神)?
  isYuanshen?: boolean;        // origin/supporting god (元神)
  isJishen?: boolean;          // hostile/jealousy god (忌神)
  isChoushen?: boolean;        // enemy god (仇神)
  void?: boolean;              // is this line in xunkong (旬空)?
  monthBroken?: boolean;       // is this line broken by the month (月破)?
  dayBroken?: boolean;         // is this line broken by the day (日破)?
  /** The 变卦's view of this line — same 纳甲, recomputed for the
   *  post-mutation trigram pair (i.e. flipping each moving line's
   *  bit and re-running the trigram 纳甲 table). For static lines
   *  these are identical to the original `stem`/`branch`/`element`.
   *  `changedSixRelative` uses the SAME `palaceElement` as the
   *  original (liuyao convention: the 变卦's sixRel is judged against
   *  the 本卦宫's element, not the 变卦's own palace's element).
   *  `changedSixGod` is intentionally NOT exposed because sixGod
   *  only depends on the day stem, not the hexagram — so the 变卦
   *  has the same gods as the 本卦. */
  changedStem?: HeavenlyStem;
  changedBranch?: EarthlyBranch;
  changedElement?: WuXing;
  changedSixRelative?: SixRelative;
  strength?: {
    labels: string[];          // human-readable tags: 旺/相/休/囚/死/得月生/...
    score?: number;            // optional numeric strength
  };
  tags?: string[];             // misc tags
}

/** Metadata for a single hexagram. */
export interface HexagramMeta {
  id: number;                  // 1~64, traditional ordering
  name: string;                // "雷水解", "天地否", etc.
  upper: Trigram;
  lower: Trigram;
  /**
   * The trigram that *defines* the palace the hexagram belongs to.
   * E.g. 乾宫八卦 all carry palace=乾; 雷水解 carries palace=震.
   * Per design.md §5.3 the PalaceSkill output uses this same field
   * as `palace` of type TrigramName.
   */
  palace: Trigram;
  palaceType: PalaceType;      // 本宫/一世/.../归魂
  element: WuXing;             // 卦宫五行
}

/** A tag/relationship between two lines or between a line and a pillar. */
export interface RelationTag {
  source: string;              // "世爻" / "二爻" / "用神" / ...
  target: string;
  type: BranchRelationType;
  description: string;
}

/** A candidate yongshen (用神) the engine proposes. */
export interface YongshenCandidate {
  relative: SixRelative;
  positions: LinePosition[];
  reason: string;
  confidence: 'low' | 'medium' | 'high';
}

/** A god (元神/忌神/仇神) the engine derives from the yongshen. */
export interface GodCandidate {
  relative: SixRelative;
  positions: LinePosition[];
  role: '元神' | '忌神' | '仇神';
}

/** What a moving line transforms into. */
export interface TransformationResult {
  position: LinePosition;
  fromBranch: EarthlyBranch;
  toBranch: EarthlyBranch;
  fromElement: WuXing;
  toElement: WuXing;
  relation: '化生' | '化克' | '回头生' | '回头克' | '化进' | '化退' | '化空' | '化破' | '普通变化';
}

/** Top-level structured result the Agent reads. */
export interface ChartResult {
  question?: string;
  questionType?: QuestionType;
  input: {
    type: 'coins' | 'numeric' | 'time' | 'hanzi' | 'manual';
    raw: unknown;
  };
  time?: {
    datetime?: string;
    timezone?: string;
    yearStem?: HeavenlyStem;
    yearBranch?: EarthlyBranch;
    monthStem?: HeavenlyStem;
    monthBranch?: EarthlyBranch;
    dayStem?: HeavenlyStem;
    dayBranch?: EarthlyBranch;
    hourStem?: HeavenlyStem;
    hourBranch?: EarthlyBranch;
    xunkong?: [EarthlyBranch, EarthlyBranch];
    solarTerm?: string;
  };
  originalHexagram: HexagramMeta;
  changedHexagram: HexagramMeta;
  movingLines: LinePosition[];
  lines: [ChartLine, ChartLine, ChartLine, ChartLine, ChartLine, ChartLine];
  relations?: {
    shiYing?: RelationTag[];
    lineRelations?: RelationTag[];
    dayRelations?: RelationTag[];
    monthRelations?: RelationTag[];
  };
  transformations?: TransformationResult[];
  yongshen?: {
    candidates: YongshenCandidate[];
    supportingGods?: GodCandidate[];
    hostileGods?: GodCandidate[];
  };
  summaryTags?: string[];
  warnings?: string[];
}

/** Cast skill output: the six raw coin values. */
export interface CastResult {
  rawValues: [YaoValue, YaoValue, YaoValue, YaoValue, YaoValue, YaoValue];
  linesBottomToTop: {
    position: LinePosition;
    value: YaoValue;
    yinYang: YinYang;
    moving: boolean;
  }[];
  movingPositions: LinePosition[];
}

/** Hexagram skill output: original + changed bits, plus matched hexagrams. */
export interface HexagramSkillOutput {
  originalLines: [YinYangBit, YinYangBit, YinYangBit, YinYangBit, YinYangBit, YinYangBit];
  changedLines:  [YinYangBit, YinYangBit, YinYangBit, YinYangBit, YinYangBit, YinYangBit];
  originalHexagram: HexagramMeta | null;
  changedHexagram:  HexagramMeta | null;
  movingLines: LinePosition[];
}
