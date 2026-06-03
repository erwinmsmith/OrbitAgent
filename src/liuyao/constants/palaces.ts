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
import type { LinePosition, Palace, PalaceType, Trigram } from '../types/basic';

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

/** Trigram → its palace. The trigram that "defines" a 宫 is the
 *  fixed one in the 八宫八卦 progression (e.g. 乾宫八卦 all carry
 *  乾 in either the upper or lower position). Used by hexagramData.ts
 *  to derive the palace of a hexagram from its (upper, lower)
 *  trigram pair. */
export const PALACE_OF_TRIGRAM: Record<Trigram, Palace> = {
  '乾': '乾宫', '坎': '坎宫', '艮': '艮宫', '震': '震宫',
  '巽': '巽宫', '离': '离宫', '坤': '坤宫', '兑': '兑宫',
};

/** Reverse: palace → its defining trigram. */
export const TRIGRAM_OF_PALACE: Record<Palace, Trigram> = {
  '乾宫': '乾', '坎宫': '坎', '艮宫': '艮', '震宫': '震',
  '巽宫': '巽', '离宫': '离', '坤宫': '坤', '兑宫': '兑',
};
