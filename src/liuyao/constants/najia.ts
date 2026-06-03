/**
 * NaJia (纳甲) — the rule for assigning Heavenly Stems and Earthly
 * Branches to each line of each of the eight pure trigrams.
 *
 * 8 trigrams × 2 positions (inner/outer) × 6 lines = 96 cells.
 *
 * Source: docs/base_knowledge/装卦方法.md 装纳甲段 + 装纳甲歌诀.
 * ✅ Knowledge base complete.
 */
import type { Trigram, HeavenlyStem, EarthlyBranch, LinePosition } from '../types/basic';

/** Inner (下/内卦) branches, bottom-to-top: 乾内=子寅辰. */
const INNER_BRANCHES: Record<Trigram, [EarthlyBranch, EarthlyBranch, EarthlyBranch]> = {
  '乾': ['子', '寅', '辰'],
  '坎': ['寅', '辰', '午'],
  '艮': ['辰', '午', '申'],
  '震': ['子', '寅', '辰'],
  '巽': ['丑', '亥', '酉'],
  '离': ['卯', '丑', '亥'],
  '兑': ['巳', '卯', '丑'],
  '坤': ['未', '巳', '卯'],
};

/** Outer (上/外卦) branches, bottom-to-top (= positions 4,5,6). */
const OUTER_BRANCHES: Record<Trigram, [EarthlyBranch, EarthlyBranch, EarthlyBranch]> = {
  '乾': ['午', '申', '戌'],
  '坎': ['申', '戌', '子'],
  '艮': ['戌', '子', '寅'],
  '震': ['午', '申', '戌'],
  '巽': ['未', '巳', '卯'],
  '离': ['酉', '未', '巳'],
  '兑': ['亥', '酉', '未'],
  '坤': ['丑', '亥', '酉'],
};

/** Inner stem (uniform per trigram). */
const INNER_STEM: Record<Trigram, HeavenlyStem> = {
  '乾': '甲', '坎': '戊', '艮': '丙', '震': '庚',
  '巽': '辛', '离': '己', '兑': '丁', '坤': '乙',
};
/** Outer stem (uniform per trigram). */
const OUTER_STEM: Record<Trigram, HeavenlyStem> = {
  '乾': '壬', '坎': '戊', '艮': '丙', '震': '庚',
  '巽': '辛', '离': '己', '兑': '丁', '坤': '癸',
};

/** Lookup the (stem, branch) for a given trigram at a given 1-6 line. */
export function najiaFor(trigram: Trigram, position: LinePosition):
  { stem: HeavenlyStem; branch: EarthlyBranch } {
  if (position < 1 || position > 6) throw new Error(`invalid line position: ${position}`);
  const isInner = position <= 3;
  const idx = (isInner ? position - 1 : position - 4) as 0 | 1 | 2;
  const stem = isInner ? INNER_STEM[trigram] : OUTER_STEM[trigram];
  const branch = isInner ? INNER_BRANCHES[trigram][idx] : OUTER_BRANCHES[trigram][idx];
  return { stem, branch };
}
