/**
 * 24 solar terms (节气) — used to map a solar datetime to a
 * 阴历 month branch and a 干支 year. The 24 solar-term dates drift
 * year to year (公历 2/3 ~ 2/5 are all possible 立春 dates) so the
 * canonical source is a 天文 algorithm.
 *
 * Status: NOT YET FILLED IN. See KNOWLEDGE_NEEDED.md §13.
 */
import type { EarthlyBranch } from '../types/basic';
import { todo } from './todo';
export { todo };

/** The 12 节气月 branches, in order from 立春. */
export const SOLAR_TERM_MONTH_BRANCH: readonly EarthlyBranch[] = [
  '寅', '卯', '辰', '巳', '午', '未',
  '申', '酉', '戌', '亥', '子', '丑',
] as const;

export function monthBranchForSolarTerm(termIndex: number): EarthlyBranch {
  if (termIndex < 0 || termIndex > 11) todo('13', 'invalid term index');
  return SOLAR_TERM_MONTH_BRANCH[termIndex]!;
}

/**
 * Compute the (year, month) pillars from a solar datetime. Stub —
 * real impl needs a 紫金山天文台 算法 or a 查表.  We expose a function
 * signature so the Calendar skill can be written; the implementation
 * throws until the algorithm is supplied.
 */
export function deriveCalendarPillars(_datetime: Date, _timezone: string): never {
  todo('13', 'deriveCalendarPillars (solar datetime → 4 pillars + xunkong)');
}
