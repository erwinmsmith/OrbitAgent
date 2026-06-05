/**
 * Coarse yao (爻) value handling — the 4 values 6,7,8,9 that come out
 * of three coin throws (正=3, 反=2). Pure procedural logic,
 * no external data.
 */
import type { YaoValue, YinYang, YinYangBit, LinePosition } from '../types/basic';

/** A single 3-coin throw, mapped to a YaoValue. */
export function coinToYaoValue(back: number, face: number): YaoValue {
  if (back < 0 || face < 0) throw new Error('coin counts must be non-negative');
  if (back + face !== 3) throw new Error(`expected 3 coins, got ${back + face}`);
  // Project rule: 正=3，反=2. Sum maps directly to the yao value:
  //   反反反 = 6 老阴，正反反 = 7 少阳，
  //   正正反 = 8 少阴，正正正 = 9 老阳。
  if (back === 3) return 6;
  if (face === 3) return 9;
  if (face === 1) return 7;
  return 8;
}

/** Three coins (0=back,1=face) → one yao value. */
export function threeCoinsToYaoValue(coins: [0 | 1, 0 | 1, 0 | 1]): YaoValue {
  const back = coins.filter((c) => c === 0).length;
  const face = 3 - back;
  return coinToYaoValue(back, face);
}

/** Yao value → yin/yang. 6/8 are yin, 7/9 are yang. */
export function yaoYinYang(v: YaoValue): YinYang {
  return v === 7 || v === 9 ? '阳' : '阴';
}

/** Yao value → whether it's a moving line. Only 6 (老阴) and 9 (老阳). */
export function isMoving(v: YaoValue): boolean {
  return v === 6 || v === 9;
}

/** Flip a moving yao: 6 (yin) → 9 (yang) becomes a new yang line, 9→6. */
export function flipYao(v: YaoValue): YaoValue {
  if (v === 6) return 9;       // old-yin flips to yang
  if (v === 9) return 6;       // old-yang flips to yin
  return v;                    // 7/8 are static
}

/** Yao value → bit (1=yang, 0=yin). For original/changed arrays. */
export function yaoToBit(v: YaoValue): YinYangBit {
  return v === 7 || v === 9 ? 1 : 0;
}

/** For 6 throws, in input order (low line first). */
export const LINE_POSITIONS: readonly LinePosition[] = [1, 2, 3, 4, 5, 6];
