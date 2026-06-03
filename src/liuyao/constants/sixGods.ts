/**
 * Six Gods (六神) table — placed on the six lines starting from the
 * bottom, in fixed sequence, with the starting god determined by the
 * day stem.
 *
 * Source: docs/base_knowledge/装卦方法.md 装六兽段.
 * ✅ Complete.
 */
import type { SixGod, HeavenlyStem, LinePosition } from '../types/basic';

const SEQUENCE: readonly SixGod[] = ['青龙', '朱雀', '勾陈', '螣蛇', '白虎', '玄武'];

/** Day stem → starting god at the bottom line (初爻). */
const DAY_STEM_START: Record<HeavenlyStem, SixGod> = {
  '甲': '青龙', '乙': '青龙',
  '丙': '朱雀', '丁': '朱雀',
  '戊': '勾陈',
  '己': '螣蛇',
  '庚': '白虎', '辛': '白虎',
  '壬': '玄武', '癸': '玄武',
};

export function sixGodsForDayStem(dayStem: HeavenlyStem):
  [SixGod, SixGod, SixGod, SixGod, SixGod, SixGod] {
  const start = DAY_STEM_START[dayStem];
  const startIdx = SEQUENCE.indexOf(start);
  return [1, 2, 3, 4, 5, 6].map(
    (pos) => SEQUENCE[(startIdx + (pos - 1)) % SEQUENCE.length]!,
  ) as [SixGod, SixGod, SixGod, SixGod, SixGod, SixGod];
}

export const SIX_GOD_SEQUENCE: readonly SixGod[] = SEQUENCE;

/** The line index → god for a given day stem, pre-computed. */
export function sixGodForLine(dayStem: HeavenlyStem, position: LinePosition): SixGod {
  return sixGodsForDayStem(dayStem)[position - 1]!;
}
