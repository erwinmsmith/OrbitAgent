/**
 * 5.7 Calendar Skill — convert a solar datetime to the 4 pillars
 * (year/month/day/hour) + xunkong.
 *
 * Status: NOT YET FILLED IN. The full implementation needs
 *   - a 24 节气 → 公历 date algorithm
 *   - a 公历 date → 60 甲子 index algorithm
 *   - the xunkong lookup (§11)
 *
 * All of these are listed in docs/liuyao/KNOWLEDGE_NEEDED.md. Until
 * they're filled in, the user can pass dayStem/dayBranch/etc. manually
 * via the API (calendar-free path).
 */
import type { CalendarSkillInput, CalendarSkillOutput } from '../types/skill';
import { deriveCalendarPillars, SOLAR_TERM_MONTH_BRANCH, todo } from '../constants/calendar';
import { xunkongForDayStem, todo as todoXunkong } from '../constants/xunkong';
import { yongshenFor } from '../constants/yongshen';

export function calendarSkill(input: CalendarSkillInput): CalendarSkillOutput {
  // We need an algorithm to convert a solar datetime to 4 pillars. Until
  // that lands (§13), we accept that this function throws. Callers in
  // MVP mode can pass dayStem/dayBranch directly.
  let date: Date;
  try {
    date = new Date(input.datetime);
    if (isNaN(date.getTime())) throw new Error('invalid datetime');
  } catch {
    throw new Error(`calendarSkill: invalid datetime string: ${input.datetime}`);
  }

  try {
    deriveCalendarPillars(date, input.timezone);
  } catch (e) {
    todo('13', 'deriveCalendarPillars — solar datetime → 4 pillars + xunkong');
  }

  // Below unreachable until the algorithm is supplied, but satisfies
  // the declared return type.
  return {
    yearStem: '甲', yearBranch: '子',
    monthStem: '甲', monthBranch: SOLAR_TERM_MONTH_BRANCH[0]!,
    dayStem: '甲', dayBranch: '子',
    xunkong: ['戌', '亥'] as any,
  };
}
