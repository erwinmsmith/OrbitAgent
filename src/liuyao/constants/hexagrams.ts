/**
 * The 64 hexagrams (六十四卦). This is the single most important
 * hard-coded table in the engine — without it, the hexagram skill
 * cannot match a name to a trigram pair, and the palace skill cannot
 * find the world-line (世爻) position.
 *
 * Source: NOT YET FILLED IN. The 装卦方法.md 八宫卦序段 lists the
 * names per palace but doesn't include upper/lower trigrams or palace
 * type. See docs/liuyao/KNOWLEDGE_NEEDED.md §5 for what to source.
 *
 * Plan (after data is filled in): one entry per hexagram, indexed by
 * 1-64 in the King Wen (文王) ordering. Each entry has the upper/lower
 * trigrams, the palace it belongs to, and its palaceType (本宫/一世/.../
 * 归魂). The chart assembler uses this to fill in the
 * originalHexagram + changedHexagram fields of ChartResult.
 */
import type { Trigram, PalaceType } from '../types/basic';
import type { HexagramMeta } from '../types/chart';
import { todo } from './todo';
export { todo };

// TODO §5 — see KNOWLEDGE_NEEDED.md. The 64 hexagrams table is the
// single most important hard-coded dataset; until it's filled in, every
// downstream skill that needs it will throw a TodoError pointing here.
// We initialize an empty map so the rest of the module loads; the
// todo() runs the first time hexagramSkill() / palaceSkill() / etc.
// is invoked, not at import time.

/** Lookup table: 1-64 → hexagram metadata. */
export const HEXAGRAMS: Record<number, HexagramMeta> = {} as Record<number, HexagramMeta>;

/** Reverse: name → hexagram metadata (used when 排盘 returns 卦名 by name). */
export const HEXAGRAMS_BY_NAME: Record<string, HexagramMeta> = {} as Record<string, HexagramMeta>;

/**
 * Build a 6-bit index from a hexagram's upper/lower trigram pair. We
 * order bits bottom-to-top: lines 1,2,3 = lower, lines 4,5,6 = upper.
 * This lets us reverse-lookup hexagrams by their raw line bits.
 */
export function bitsFromTrigrams(upper: Trigram, lower: Trigram): string {
  // trigram→bits tables live in trigrams.ts. Import lazily to avoid
  // circular dep at module init.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TRIGRAM_BITS } = require('./trigrams') as typeof import('./trigrams');
  return [...TRIGRAM_BITS[lower], ...TRIGRAM_BITS[upper]].join('');
}

export const HEXAGRAMS_BY_BITS: Record<string, HexagramMeta> = {} as Record<string, HexagramMeta>;
