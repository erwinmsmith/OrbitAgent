/**
 * Five-element (五行) relations: 生 (生), 克 (克), 比 (same).
 * ✅ 通用知识 — design.md §5.5.
 */
import type { WuXing } from '../types/basic';

/** Element → element it produces (我生者). */
export const WUXING_SHENG: Record<WuXing, WuXing> = {
  '金': '水',
  '水': '木',
  '木': '火',
  '火': '土',
  '土': '金',
};

/** Element → element it overcomes (我克者). */
export const WUXING_KE: Record<WuXing, WuXing> = {
  '金': '木',
  '木': '土',
  '土': '水',
  '水': '火',
  '火': '金',
};

/** Element → element that produces it (生我者). */
export function producesOf(x: WuXing): WuXing {
  for (const [k, v] of Object.entries(WUXING_SHENG) as [WuXing, WuXing][]) {
    if (v === x) return k;
  }
  throw new Error(`no producer for ${x}`);
}

/** Element → element that overcomes it (克我者). */
export function overcomesOf(x: WuXing): WuXing {
  for (const [k, v] of Object.entries(WUXING_KE) as [WuXing, WuXing][]) {
    if (v === x) return k;
  }
  throw new Error(`no overcomer for ${x}`);
}
