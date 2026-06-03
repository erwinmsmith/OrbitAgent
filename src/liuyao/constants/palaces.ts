/**
 * Eight palaces (八宫) and their world-line (世爻) / response-line
 * (应爻) rules.
 *
 * Per design.md §5.3 and 装卦方法.md:
 *   本宫 → 世 6
 *   一世 → 世 1
 *   二世 → 世 2
 *   三世 → 世 3
 *   四世 → 世 4
 *   五世 → 世 5
 *   游魂 → 世 4
 *   归魂 → 世 3
 *   应 = 世+3 (mod 6, 1-indexed)
 *
 * ✅ Pure derivation once HEXAGRAMS gives us palaceType.
 */
import type { LinePosition, Palace, PalaceType } from '../types/basic';

const SHI_BY_TYPE: Record<PalaceType, LinePosition> = {
  '本宫': 6,
  '一世': 1,
  '二世': 2,
  '三世': 3,
  '四世': 4,
  '五世': 5,
  '游魂': 4,
  '归魂': 3,
};

export function shiFor(palaceType: PalaceType): LinePosition {
  return SHI_BY_TYPE[palaceType];
}

export function yingFor(palaceType: PalaceType): LinePosition {
  // 应 = 世+3 in 1-indexed 1..6 (wraps).
  const shi = SHI_BY_TYPE[palaceType];
  return (((shi + 2) % 6) + 1) as LinePosition;
}

/** Eight palace names, in the standard 后天 order. */
export const PALACES: readonly Palace[] = [
  '乾宫', '坎宫', '艮宫', '震宫',
  '巽宫', '离宫', '坤宫', '兑宫',
] as const;
