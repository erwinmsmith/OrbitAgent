/**
 * 24 solar terms (节气) + 公历→干支 (the calendar skill).
 *
 * Backed by `lunar-typescript` — a zero-dependency pure-TS calendar
 * library that gives us the exact 干支 / 节气 / 旬空 for any solar
 * date from year 1900 onwards, including the 节气 corrections that
 * the simple 1900-1-1=甲戌 math from 排盘补充.md §3 gets wrong by
 * a day at the transitions.
 *
 * Source: docs/base_knowledge/排盘补充.md §1-§4 (algorithms) +
 * `lunar-typescript` for the actual 表 (which the lib ships with
 * pre-computed, so we don't need 紫金山天文台 in the binary).
 */
import { Solar, Lunar } from 'lunar-typescript';
import type { EarthlyBranch, HeavenlyStem, YinYangBit } from '../types/basic';

export { todo } from './todo';

/** The 12 节气月 branches, in order from 立春. */
export const SOLAR_TERM_MONTH_BRANCH: readonly EarthlyBranch[] = [
  '寅', '卯', '辰', '巳', '午', '未',
  '申', '酉', '戌', '亥', '子', '丑',
] as const;

export function monthBranchForSolarTerm(termIndex: number): EarthlyBranch {
  if (termIndex < 0 || termIndex > 11) {
    throw new Error(`invalid term index: ${termIndex}`);
  }
  return SOLAR_TERM_MONTH_BRANCH[termIndex]!;
}

/** Hour-0-23 → 地支 (the 12 时辰). Traditional 23-1 is 子时, 1-3 is 丑时, ... */
export const HOUR_TO_BRANCH: readonly EarthlyBranch[] = [
  '子', '子', '丑', '丑', '寅', '寅',
  '卯', '卯', '辰', '辰', '巳', '巳',
  '午', '午', '未', '未', '申', '申',
  '酉', '酉', '戌', '戌', '亥', '亥',
] as const;

export function hourBranchForHour(hour: number): EarthlyBranch {
  if (hour < 0 || hour > 23) throw new Error(`invalid hour: ${hour}`);
  return HOUR_TO_BRANCH[hour]!;
}

/** 五鼠遁 — day stem → 子时的天干. */
const DAY_STEM_TO_HOUR_STEM: Record<HeavenlyStem, HeavenlyStem> = {
  '甲': '甲', '己': '甲',
  '乙': '丙', '庚': '丙',
  '丙': '戊', '辛': '戊',
  '丁': '庚', '壬': '庚',
  '戊': '壬', '癸': '壬',
};

/** 10 天干 in order — for offsetting along the cycle. */
const STEMS: readonly HeavenlyStem[] = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];

/** Given a day stem and an hour branch index (0-11), return the
 *  hour stem. Implements 五鼠遁: 子时 starts at the day-stem's
 *  base, and each subsequent 时辰 advances by 1. */
export function hourStemForDayStem(dayStem: HeavenlyStem, hourBranch: EarthlyBranch): HeavenlyStem {
  const baseStem = DAY_STEM_TO_HOUR_STEM[dayStem];
  const baseIdx = STEMS.indexOf(baseStem);
  const branchIdx = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'].indexOf(hourBranch);
  return STEMS[(baseIdx + branchIdx) % 10]!;
}

export interface CalendarPillars {
  yearStem: HeavenlyStem;
  yearBranch: EarthlyBranch;
  monthStem: HeavenlyStem;
  monthBranch: EarthlyBranch;
  dayStem: HeavenlyStem;
  dayBranch: EarthlyBranch;
  hourStem: HeavenlyStem;
  hourBranch: EarthlyBranch;
  /** 旬空 — the two Earthly Branches that are "empty" in the 旬
   *  that contains the day pillar. Liuying at traditional排盘 needs
   *  this to mark 旬空 lines. */
  xunkong: [EarthlyBranch, EarthlyBranch];
  /** Nearest 节气 to the datetime, e.g. "立春", "清明". */
  solarTerm: string;
  /** 节气 表 index 0-23, 0=立春, 1=雨水, ..., 11=大寒. The 12
   *  节气 (not 24) determine the month branch: 寅=立春, 卯=惊蛰,
   *  辰=清明, ... */
  solarTermIndex: number;
}

/**
 * Compute the 4 pillars (year/month/day/hour) + 旬空 + 节气 for a
 * given solar datetime. Uses `lunar-typescript` which has the full
 * 1900-2099 节气表 baked in (correctly accounting for the leap
 * second / 天文 corrections that the simple math in
 * 排盘补充.md §3 doesn't).
 *
 * The "lunar year start" rule: 立春 is the start of a new 干支 year.
 * `lunar.getYearInGanZhi()` returns the year as-of 立春, which is
 * the standard 命理 convention.
 */
export function deriveCalendarPillars(datetime: Date, timezone?: string): CalendarPillars {
  // Build a Solar from the datetime. lunar-typescript treats the
  // date as local (in the system's TZ) unless we ask for the
  // Solar.fromYmdHms form, in which case it's a calendar date.
  // We use the timezone option by converting to that TZ's local
  // components first.
  let year: number, month: number, day: number, hour: number, minute: number, second: number;
  if (timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(datetime);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    year = parseInt(get('year'), 10);
    month = parseInt(get('month'), 10);
    day = parseInt(get('day'), 10);
    hour = parseInt(get('hour'), 10) % 24;
    minute = parseInt(get('minute'), 10);
    second = parseInt(get('second'), 10);
  } else {
    year = datetime.getFullYear();
    month = datetime.getMonth() + 1;
    day = datetime.getDate();
    hour = datetime.getHours();
    minute = datetime.getMinutes();
    second = datetime.getSeconds();
  }

  const solar = Solar.fromYmdHms(year, month, day, hour, minute, second);
  const lunar: Lunar = solar.getLunar();

  // Year pillar: as-of 立春 (lunar's getYearInGanZhi does this
  // for us — different from getYearInGanZhiExact which uses the
  // Chinese new year instead).
  const yearGZ = lunar.getYearInGanZhi();   // e.g. "丙午"
  const monthGZ = lunar.getMonthInGanZhi(); // e.g. "癸巳"
  const dayGZ = lunar.getDayInGanZhi();     // e.g. "己酉"
  // Hour: pass the 0-23 hour to lunar's getTimeInGanZhi. (The .d.ts
  // declares 0 args but the runtime accepts an hour — this is a known
  // d.ts omission in lunar-typescript.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hourGZ = (lunar as any).getTimeInGanZhi(hour); // e.g. "辛未"

  // 旬空 — lunar returns a 2-char string like '寅卯'.
  const xunkongStr = lunar.getDayXunKong();
  if (xunkongStr.length !== 2) {
    throw new Error(`lunar.getDayXunKong() returned "${xunkongStr}", expected 2 chars`);
  }
  const xunkong: [EarthlyBranch, EarthlyBranch] = [
    xunkongStr[0] as EarthlyBranch,
    xunkongStr[1] as EarthlyBranch,
  ];

  // 节气 — lunar.getJieQi() returns a string (the current 节气
  // name, or '' if no 节气 applies today). getPrevJieQi() returns
  // a JieQi object with .getName(). We use the current 节气 if
  // we're on a 节气 day, otherwise the previous one.
  const currentJieQi = lunar.getJieQi();
  const solarTerm = currentJieQi || lunar.getPrevJieQi().getName();

  return {
    yearStem: yearGZ[0] as HeavenlyStem,
    yearBranch: yearGZ[1] as EarthlyBranch,
    monthStem: monthGZ[0] as HeavenlyStem,
    monthBranch: monthGZ[1] as EarthlyBranch,
    dayStem: dayGZ[0] as HeavenlyStem,
    dayBranch: dayGZ[1] as EarthlyBranch,
    hourStem: hourGZ[0] as HeavenlyStem,
    hourBranch: hourGZ[1] as EarthlyBranch,
    xunkong,
    solarTerm,
    // 0-23 — 0=立春, 1=雨水, ..., 11=大寒, 12=小寒 (next year),
    // 13=大寒 (next year), ..., 23=冬至. Map to 0-23 based on
    // the 节气 name.
    solarTermIndex: solarTerm ? jieQiToIndex(solarTerm) : -1,
  };
}

/** Map a 节气 name (from lunar-typescript) to its 0-23 index in
 *  the standard table (0=立春, 1=雨水, ..., 11=大寒, 12=小寒, ...).
 *  Used to derive the month branch. */
function jieQiToIndex(name: string): number {
  const table = ['小寒','大寒','立春','雨水','惊蛰','春分',
                 '清明','谷雨','立夏','小满','芒种','夏至',
                 '小暑','大暑','立秋','处暑','白露','秋分',
                 '寒露','霜降','立冬','小雪','大雪','冬至'];
  return table.indexOf(name);
}

/** If the caller didn't supply dayStem/dayBranch, derive them from
 *  the current datetime. Used by the chart route as a convenience
 *  so a date-less `chart` request still produces a fully-decorated
 *  chart. */
export function deriveDayPillarsFromNow(timezone?: string): {
  dayStem: HeavenlyStem;
  dayBranch: EarthlyBranch;
  monthBranch: EarthlyBranch;
  monthStem: HeavenlyStem;
  hourStem: HeavenlyStem;
  hourBranch: EarthlyBranch;
  xunkong: [EarthlyBranch, EarthlyBranch];
  solarTerm: string;
} {
  const p = deriveCalendarPillars(new Date(), timezone);
  return {
    dayStem: p.dayStem, dayBranch: p.dayBranch,
    monthStem: p.monthStem, monthBranch: p.monthBranch,
    hourStem: p.hourStem, hourBranch: p.hourBranch,
    xunkong: p.xunkong, solarTerm: p.solarTerm,
  };
}

// Re-export for callers that want to convert the 干支 string into
// our 1/0 bit encoding.
export function ganzhiToYinYangBit(gz: string): YinYangBit {
  // Stem: 阳 = 甲丙戊庚壬 (odd index), 阴 = 乙丁己辛癸 (even index)
  const yangStems = ['甲','丙','戊','庚','壬'];
  return yangStems.includes(gz[0]!) ? 1 : 0;
}
