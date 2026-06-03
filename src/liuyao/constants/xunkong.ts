/**
 * Xunkong (旬空) — the two "empty" Earthly Branches in the 10-day
 * cycle (旬) that contains the day pillar.
 *
 * Per 排盘补充.md §4 and design.md §5.9:
 *   甲/己 → 戌、亥  (甲子旬)
 *   乙/庚 → 申、酉  (甲戌旬)
 *   丙/辛 → 午、未  (甲申旬)
 *   丁/壬 → 辰、巳  (甲午旬)
 *   戊/癸 → 寅、卯  (甲辰旬)
 *
 * Each 旬 starts when the heavenly stem cycles back to 甲, and the
 * 旬首 + 10, 旬首 + 11 (mod 12) of branches are 空亡. The mnemonic:
 * 甲子旬 starts with 子, the missing two are 戌/亥.
 *
 * The two xunkong branches are then used by the void skill to mark
 * any line whose branch matches one of the two.
 */
import type { EarthlyBranch, HeavenlyStem } from '../types/basic';

export const XUNKONG_BY_DAY_STEM: Record<HeavenlyStem, [EarthlyBranch, EarthlyBranch]> = {
  '甲': ['戌', '亥'], '己': ['戌', '亥'],
  '乙': ['申', '酉'], '庚': ['申', '酉'],
  '丙': ['午', '未'], '辛': ['午', '未'],
  '丁': ['辰', '巳'], '壬': ['辰', '巳'],
  '戊': ['寅', '卯'], '癸': ['寅', '卯'],
};

export function xunkongForDayStem(dayStem: HeavenlyStem): [EarthlyBranch, EarthlyBranch] {
  return XUNKONG_BY_DAY_STEM[dayStem];
}

// Re-export `todo` so the few legacy callers (calendarSkill, voidSkill)
// that used to depend on the empty placeholder can keep their import
// shape; the table is now complete so the actual call won't trigger
// the todo() path.
export { todo } from './todo';
