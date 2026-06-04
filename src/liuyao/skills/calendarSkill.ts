/**
 * 5.7 Calendar Skill — convert a solar datetime to the 4 pillars
 * (year/month/day/hour) + xunkong + 节气.
 *
 * Backed by `lunar-typescript` (see constants/calendar.ts). The lib
 * ships with the full 1900-2099 节气表 baked in, so the skill is
 * now production-ready for any solar datetime in that window.
 */
import type { CalendarSkillInput, CalendarSkillOutput } from '../types/skill';
import { deriveCalendarPillars } from '../constants/calendar';

export function calendarSkill(input: CalendarSkillInput): CalendarSkillOutput {
  let date: Date;
  try {
    date = new Date(input.datetime);
    if (isNaN(date.getTime())) throw new Error('invalid datetime');
  } catch {
    throw new Error(`calendarSkill: invalid datetime string: ${input.datetime}`);
  }

  const p = deriveCalendarPillars(date, input.timezone);
  return {
    yearStem: p.yearStem,
    yearBranch: p.yearBranch,
    monthStem: p.monthStem,
    monthBranch: p.monthBranch,
    dayStem: p.dayStem,
    dayBranch: p.dayBranch,
    hourStem: p.hourStem,
    hourBranch: p.hourBranch,
    xunkong: p.xunkong,
    solarTerm: p.solarTerm,
  };
}
