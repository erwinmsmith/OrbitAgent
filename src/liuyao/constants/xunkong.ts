/**
 * Xunkong (旬空) — the two "empty" Earthly Branches in the 10-day
 * cycle (旬) that contains the day pillar.
 *
 * For each day stem, the 旬 (decade) is fixed; the two branches in
 * the 12-cycle that are missing from the 旬 are the xunkong.
 *
 * Source: design.md §5.9, 六爻卦理.md §2.
 * Status: NOT YET FILLED IN. See KNOWLEDGE_NEEDED.md §11.
 */
import type { EarthlyBranch, HeavenlyStem } from '../types/basic';
import { todo } from './todo';
export { todo };

/**
 * Day stem → the two branches that are xunkong. Empty until §11 is
 * filled in; xunkongForDayStem() throws at first use.
 */
export const XUNKONG_BY_DAY_STEM: Record<HeavenlyStem, [EarthlyBranch, EarthlyBranch]> = {} as any;

export function xunkongForDayStem(dayStem: HeavenlyStem): [EarthlyBranch, EarthlyBranch] {
  // TODO §11 — see KNOWLEDGE_NEEDED.md. Standard table:
  //   甲/己 → 戌、亥
  //   乙/庚 → 申、酉
  //   丙/辛 → 午、未
  //   丁/壬 → 辰、巳
  //   戊/癸 → 寅、卯
  const v = XUNKONG_BY_DAY_STEM[dayStem];
  if (!v) todo('11', `xunkongForDayStem(${dayStem}) — XUNKONG_BY_DAY_STEM table empty`);
  return v;
}
