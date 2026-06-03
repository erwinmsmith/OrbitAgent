/**
 * Six Relatives (六亲) — determined per line by the relationship
 * between the line's element and the palace's element.
 *
 * Rule (装卦方法.md 装六亲段):
 *   same element  → 兄弟
 *   produces me   → 父母
 *   I produce     → 子孙
 *   overcomes me  → 官鬼
 *   I overcome    → 妻财
 *
 * ✅ Pure logic over the existing WUXING_SHENG/KE tables.
 */
import type { SixRelative, WuXing } from '../types/basic';
import { WUXING_KE, WUXING_SHENG } from './wuxing';

export function relativeOf(palace: WuXing, lineElement: WuXing): SixRelative {
  if (palace === lineElement) return '兄弟';
  if (WUXING_SHENG[palace] === lineElement) return '子孙';      // 我生者
  if (WUXING_KE[palace] === lineElement) return '妻财';        // 我克者
  if (WUXING_SHENG[lineElement] === palace) return '父母';      // 生我者
  if (WUXING_KE[lineElement] === palace) return '官鬼';        // 克我者
  throw new Error(`unreachable: palace=${palace} line=${lineElement}`);
}
