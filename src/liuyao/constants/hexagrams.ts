/**
 * The 64-hexagram lookup tables — re-exports the data module which
 * parses `docs/base_knowledge/64卦数据.json` at module-load time.
 *
 * Source: docs/base_knowledge/64卦数据.json (✅ Complete — 64 entries
 * with 卦辞, 爻辞, symbol, type, shi, ying, upper/lower trigram).
 *
 * The data module also derives `palace`, `element`, and `palaceType`
 * from each entry's trigram pair; see hexagramData.ts for the
 * derivation rules.
 */
import type { Trigram } from '../types/basic';
import type { HexagramMeta } from '../types/chart';
import { TRIGRAM_BITS } from './trigrams';

export {
  HEXAGRAMS,
  HEXAGRAMS_BY_NAME,
  HEXAGRAMS_BY_BITS,
  HEXAGRAM_RAW_DATA,
} from './hexagramData';

// Re-export the todo() helper so existing callers (hexagramSkill,
// palaceSkill, fushenSkill) don't have to switch imports now that
// the table is no longer empty.
export { todo } from './todo';

/** Build a 6-bit index from a hexagram's upper/lower trigram pair. We
 *  order bits bottom-to-top: lines 1,2,3 = lower, lines 4,5,6 = upper.
 *  This lets us reverse-lookup hexagrams by their raw line bits. */
export function bitsFromTrigrams(upper: Trigram, lower: Trigram): string {
  return [...TRIGRAM_BITS[lower], ...TRIGRAM_BITS[upper]].join('');
}
