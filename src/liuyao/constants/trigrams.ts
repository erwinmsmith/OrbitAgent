/**
 * Eight trigrams and their five-element (五行) classifications.
 *
 * Source: 装卦方法.md / 易经详解 — both handbooks agree.
 * No external data needed.
 */
import type { Trigram, WuXing } from '../types/basic';

export const TRIGRAM_ELEMENT: Record<Trigram, WuXing> = {
  '乾': '金',
  '兑': '金',
  '坎': '水',
  '震': '木',
  '巽': '木',
  '离': '火',
  '艮': '土',
  '坤': '土',
};

/** Lower (内) trigram line bit pattern, bottom-to-top, 1=yang, 0=yin. */
export const TRIGRAM_BITS: Record<Trigram, [0 | 1, 0 | 1, 0 | 1]> = {
  '乾': [1, 1, 1],   // ☰
  '兑': [1, 1, 0],   // ☱
  '离': [1, 0, 1],   // ☲
  '震': [1, 0, 0],   // ☳
  '巽': [0, 1, 1],   // ☴
  '坎': [0, 1, 0],   // ☵
  '艮': [0, 0, 1],   // ☶
  '坤': [0, 0, 0],   // ☷
};

/** Reverse: a 3-bit pattern → trigram. */
export const BITS_TO_TRIGRAM: Record<string, Trigram> =
  Object.fromEntries(Object.entries(TRIGRAM_BITS).map(([t, b]) => [b.join(''), t as Trigram]));

/** The eight palace names (八宫), each tied to a trigram. */
export const PALACE_TRIGRAM = ['乾', '坎', '艮', '震', '巽', '离', '坤', '兑'] as const;
