/**
 * Ten Heavenly Stems (天干) and their five-element classifications.
 * ✅ 通用知识 — no external data needed.
 */
import type { HeavenlyStem, WuXing } from '../types/basic';

export const STEMS: readonly HeavenlyStem[] = [
  '甲', '乙', '丙', '丁', '戊',
  '己', '庚', '辛', '壬', '癸',
] as const;

export const STEM_ELEMENT: Record<HeavenlyStem, WuXing> = {
  '甲': '木', '乙': '木',
  '丙': '火', '丁': '火',
  '戊': '土', '己': '土',
  '庚': '金', '辛': '金',
  '壬': '水', '癸': '水',
};

/** Five-combinations of stems (天干五合). ✅ 通用知识. */
export const STEM_COMBINE: Record<HeavenlyStem, HeavenlyStem> = {
  '甲': '己', '己': '甲',
  '乙': '庚', '庚': '乙',
  '丙': '辛', '辛': '丙',
  '丁': '壬', '壬': '丁',
  '戊': '癸', '癸': '戊',
};
