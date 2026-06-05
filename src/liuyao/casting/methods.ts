import type { LinePosition, Trigram, YaoValue, YinYangBit } from '../types/basic';
import { TRIGRAM_BITS } from '../constants/trigrams';

export type CastingMethod = 'manual' | 'coins' | 'time' | 'numbers' | 'character';
export type CoinFace = '正' | '反';

export interface CastingInput {
  method?: string;
  bits?: unknown;
  yaoValues?: unknown;
  coins?: unknown;
  numbers?: unknown;
  character?: unknown;
  text?: unknown;
  datetime?: unknown;
  timezone?: unknown;
}

export interface CastingResult {
  method: CastingMethod;
  yaoValues: [YaoValue, YaoValue, YaoValue, YaoValue, YaoValue, YaoValue];
  movingLines: LinePosition[];
  meta: Record<string, unknown>;
}

const XIANTIAN_TRIGRAM_BY_NUMBER: Record<number, Trigram> = {
  1: '乾',
  2: '兑',
  3: '离',
  4: '震',
  5: '巽',
  6: '坎',
  7: '艮',
  8: '坤',
};

const COMMON_MODERN_STROKES: Record<string, number> = {
  财: 7,
  財: 10,
  易: 8,
  卦: 8,
  问: 6,
  問: 11,
  事: 8,
  官: 8,
  讼: 6,
  訟: 11,
  婚: 11,
  姻: 9,
  感: 13,
  情: 11,
  业: 5,
  業: 13,
  合: 6,
  同: 6,
  病: 10,
  钱: 10,
  錢: 16,
  人: 2,
  我: 7,
  他: 5,
  她: 6,
  家: 10,
  子: 3,
  父: 4,
  母: 5,
  兄: 5,
  弟: 7,
  夫: 4,
  妻: 8,
  求: 7,
  成: 6,
  去: 5,
  来: 7,
  來: 8,
  行: 6,
  出: 5,
  失: 5,
  物: 8,
};

export function normalizeCastingMethod(method: unknown): CastingMethod {
  const raw = String(method || 'manual').trim().toLowerCase();
  if (!raw || raw === 'manual' || raw === 'input' || raw === 'direct') return 'manual';
  if (raw === 'coins' || raw === 'coin' || raw === 'auto' || raw === 'random') return 'coins';
  if (raw === 'time' || raw === 'datetime' || raw === 'date') return 'time';
  if (raw === 'numbers' || raw === 'number' || raw === 'num') return 'numbers';
  if (raw === 'character' || raw === 'char' || raw === 'hanzi' || raw === 'text') return 'character';
  throw new Error(`unknown casting method "${method}"`);
}

export function resolveCasting(input: CastingInput, random: () => number = Math.random): CastingResult {
  const method = normalizeCastingMethod(input.method);
  switch (method) {
    case 'manual':
      return castFromManual(input);
    case 'coins':
      return castFromCoins(input.coins, random);
    case 'time':
      return castFromTime(input.datetime, input.timezone);
    case 'numbers':
      return castFromNumbers(input.numbers);
    case 'character':
      return castFromCharacter(input.character ?? input.text, input.datetime, input.timezone);
  }
}

export function castFromManual(input: Pick<CastingInput, 'bits' | 'yaoValues'>): CastingResult {
  if (Array.isArray(input.yaoValues)) {
    const yaoValues = normalizeYaoValues(input.yaoValues);
    return {
      method: 'manual',
      yaoValues,
      movingLines: movingLinesOf(yaoValues),
      meta: { source: 'manual-yaoValues' },
    };
  }
  if (Array.isArray(input.bits)) {
    const bits = normalizeBits(input.bits);
    const yaoValues = bits.map((b) => (b === 1 ? 7 : 8)) as CastingResult['yaoValues'];
    return {
      method: 'manual',
      yaoValues,
      movingLines: [],
      meta: { source: 'manual-bits', bits },
    };
  }
  throw new Error('manual casting requires either bits (6 × 0/1) or yaoValues (6 × 6/7/8/9)');
}

export function castFromCoins(coins: unknown, random: () => number = Math.random): CastingResult {
  const throws = normalizeCoinThrows(coins, random);
  const yaoValues = throws.map((faces) => coinThrowToYaoValue(faces)) as CastingResult['yaoValues'];
  return {
    method: 'coins',
    yaoValues,
    movingLines: movingLinesOf(yaoValues),
    meta: {
      rule: '三枚硬币，正=3，反=2；每爻一摇，自初爻到上爻',
      throws,
      sums: throws.map((faces) => faces.reduce((sum, face) => sum + (face === '正' ? 3 : 2), 0)),
    },
  };
}

export function castFromTime(datetime: unknown, timezone: unknown): CastingResult {
  const parts = localDateParts(datetime, timezone);
  const upperNumber = modulo(parts.year + parts.month + parts.day, 8);
  const lowerNumber = modulo(parts.year + parts.month + parts.day + parts.hourBranchNumber, 8);
  const movingLine = modulo(parts.year + parts.month + parts.day + parts.hourBranchNumber, 6) as LinePosition;
  return castFromTrigrams(upperNumber, lowerNumber, movingLine, 'time', {
    rule: '年+月+日取上卦；年+月+日+时辰数取下卦和动爻；使用先天八卦数',
    datetime: parts.iso,
    timezone: parts.timezone,
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    hourBranchNumber: parts.hourBranchNumber,
  });
}

export function castFromNumbers(numbers: unknown): CastingResult {
  const ns = normalizeNumbers(numbers);
  const upperNumber = modulo(ns[0], 8);
  const lowerNumber = modulo(ns[1], 8);
  const movingLine = modulo(ns[2], 6) as LinePosition;
  return castFromTrigrams(upperNumber, lowerNumber, movingLine, 'numbers', {
    rule: '三数起卦：第一个数取上卦，第二个数取下卦，第三个数取动爻；使用先天八卦数',
    numbers: ns,
  });
}

export function castFromCharacter(character: unknown, datetime: unknown, timezone: unknown): CastingResult {
  const char = firstCharacter(character);
  const parts = localDateParts(datetime, timezone);
  const strokeCount = COMMON_MODERN_STROKES[char];
  const codePoint = char.codePointAt(0)!;
  const basis = strokeCount ?? codePoint;
  const basisSource = strokeCount ? 'modern-stroke-dictionary' : 'unicode-code-point-fallback';
  const upperNumber = modulo(basis, 8);
  const lowerNumber = modulo(basis + parts.hourBranchNumber, 8);
  const movingLine = modulo(basis + parts.day + parts.hourBranchNumber, 6) as LinePosition;
  return castFromTrigrams(upperNumber, lowerNumber, movingLine, 'character', {
    rule: '优先用现代笔画数；上卦取笔画数，下卦取笔画数+时辰数，动爻取笔画数+日数+时辰数；查不到笔画用 Unicode 码点兜底',
    character: char,
    basis,
    basisSource,
    strokeCount,
    codePoint,
    day: parts.day,
    hourBranchNumber: parts.hourBranchNumber,
    datetime: parts.iso,
    timezone: parts.timezone,
  });
}

export function coinThrowToYaoValue(faces: readonly CoinFace[]): YaoValue {
  if (faces.length !== 3) throw new Error(`expected 3 coins, got ${faces.length}`);
  const sum = faces.reduce((total, face) => {
    if (face !== '正' && face !== '反') throw new Error(`coin face must be 正 or 反, got "${face}"`);
    return total + (face === '正' ? 3 : 2);
  }, 0);
  if (sum === 6) return 6;
  if (sum === 7) return 7;
  if (sum === 8) return 8;
  if (sum === 9) return 9;
  throw new Error(`invalid three-coin sum ${sum}`);
}

function castFromTrigrams(
  upperNumber: number,
  lowerNumber: number,
  movingLine: LinePosition,
  method: Exclude<CastingMethod, 'manual' | 'coins'>,
  meta: Record<string, unknown>,
): CastingResult {
  const upperTrigram = XIANTIAN_TRIGRAM_BY_NUMBER[upperNumber]!;
  const lowerTrigram = XIANTIAN_TRIGRAM_BY_NUMBER[lowerNumber]!;
  const bits = [...TRIGRAM_BITS[lowerTrigram], ...TRIGRAM_BITS[upperTrigram]] as [
    YinYangBit, YinYangBit, YinYangBit, YinYangBit, YinYangBit, YinYangBit
  ];
  const yaoValues = bits.map((bit, i) => {
    const isMovingLine = i + 1 === movingLine;
    if (bit === 1) return isMovingLine ? 9 : 7;
    return isMovingLine ? 6 : 8;
  }) as CastingResult['yaoValues'];
  return {
    method,
    yaoValues,
    movingLines: [movingLine],
    meta: {
      ...meta,
      upperNumber,
      upperTrigram,
      lowerNumber,
      lowerTrigram,
      movingLine,
      bits,
      xiantian: XIANTIAN_TRIGRAM_BY_NUMBER,
    },
  };
}

function normalizeYaoValues(values: unknown[]): CastingResult['yaoValues'] {
  if (values.length !== 6) throw new Error(`yaoValues expects 6 entries, got ${values.length}`);
  const out = values.map((v) => Number(v));
  for (const v of out) {
    if (v !== 6 && v !== 7 && v !== 8 && v !== 9) {
      throw new Error(`yaoValue must be 6|7|8|9, got ${v}`);
    }
  }
  return out as CastingResult['yaoValues'];
}

function normalizeBits(values: unknown[]): [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1] {
  if (values.length !== 6) throw new Error(`bits expects 6 entries, got ${values.length}`);
  const out = values.map((v) => Number(v));
  for (const v of out) {
    if (v !== 0 && v !== 1) throw new Error(`bit must be 0|1, got ${v}`);
  }
  return out as [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1];
}

function normalizeNumbers(numbers: unknown): [number, number, number] {
  const raw = Array.isArray(numbers)
    ? numbers
    : typeof numbers === 'string'
      ? numbers.split(/[,\s]+/).filter(Boolean)
      : [];
  if (raw.length !== 3) {
    throw new Error('numbers casting requires exactly 3 numbers');
  }
  const ns = raw.map((n) => Number(n));
  if (ns.some((n) => !Number.isFinite(n))) {
    throw new Error('numbers casting accepts finite numbers only');
  }
  return ns.map((n) => Math.trunc(n)) as [number, number, number];
}

function normalizeCoinThrows(coins: unknown, random: () => number): [CoinFace, CoinFace, CoinFace][] {
  if (!Array.isArray(coins)) {
    return Array.from({ length: 6 }, () => randomCoinThrow(random));
  }
  if (coins.length !== 6) throw new Error(`coins casting expects 6 throws, got ${coins.length}`);
  return coins.map((throwValue, i) => {
    if (!Array.isArray(throwValue) || throwValue.length !== 3) {
      throw new Error(`coin throw ${i + 1} must contain 3 coin faces`);
    }
    return throwValue.map(normalizeCoinFace) as [CoinFace, CoinFace, CoinFace];
  });
}

function randomCoinThrow(random: () => number): [CoinFace, CoinFace, CoinFace] {
  return [
    random() < 0.5 ? '反' : '正',
    random() < 0.5 ? '反' : '正',
    random() < 0.5 ? '反' : '正',
  ];
}

function normalizeCoinFace(value: unknown): CoinFace {
  if (value === '正' || value === 'face' || value === 'heads' || value === 1 || value === 3) return '正';
  if (value === '反' || value === 'back' || value === 'tails' || value === 0 || value === 2) return '反';
  throw new Error(`coin face must be 正/反, heads/tails, 1/0, or 3/2; got "${value}"`);
}

function firstCharacter(value: unknown): string {
  const text = String(value ?? '').trim();
  const chars = Array.from(text);
  if (chars.length !== 1) throw new Error('character casting requires exactly one character');
  return chars[0]!;
}

function localDateParts(datetime: unknown, timezone: unknown): {
  iso: string;
  timezone: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  hourBranchNumber: number;
} {
  const date = datetime ? new Date(String(datetime)) : new Date();
  if (isNaN(date.getTime())) throw new Error(`invalid datetime "${datetime}"`);
  const tz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'Asia/Shanghai';
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  if (![year, month, day, hour].every(Number.isFinite)) {
    throw new Error(`cannot derive local date parts for timezone "${tz}"`);
  }
  return {
    iso: date.toISOString(),
    timezone: tz,
    year,
    month,
    day,
    hour,
    hourBranchNumber: hourToBranchNumber(hour),
  };
}

function hourToBranchNumber(hour: number): number {
  if (hour < 0 || hour > 23) throw new Error(`hour must be 0-23, got ${hour}`);
  if (hour === 23 || hour === 0) return 1;
  return Math.floor((hour + 1) / 2) + 1;
}

function modulo(value: number, base: 6 | 8): number {
  const remainder = Math.abs(Math.trunc(value)) % base;
  return remainder === 0 ? base : remainder;
}

function movingLinesOf(values: readonly YaoValue[]): LinePosition[] {
  return values
    .map((v, i) => (v === 6 || v === 9 ? (i + 1) as LinePosition : null))
    .filter((v): v is LinePosition => v != null);
}
