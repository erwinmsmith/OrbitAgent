/**
 * Sixty 甲子 (stem-branch) cycle — used by the Calendar skill to
 * compute day/month/year pillars and to derive xunkong (旬空).
 *
 * Source: design.md §5.7, 六爻基础.md / 六爻卦理.md.
 *
 * Status: NOT YET FILLED IN. We need either the 60-element table
 * (stem, branch) or a derivation routine from a Julian Day Number.
 * The latter is more flexible (handles arbitrary dates) but needs a
 * verifiable algorithm. The former is trivial but means 60 hard-coded
 * entries.
 *
 * See docs/liuyao/KNOWLEDGE_NEEDED.md §10.
 */
import type { EarthlyBranch, HeavenlyStem } from '../types/basic';
import { todo } from './todo';

export const SIXTY_JIAZI: ReadonlyArray<{ stem: HeavenlyStem; branch: EarthlyBranch }> = [];

/** Map: (stem, branch) pair → its 1-60 position. */
export const JIAZI_INDEX: Map<string, number> = new Map();

/**
 * Convenience: a stem→branch stem-by-stem mapping used to derive a
 * pillar. (This is the *other* common lookup, but the cleanest answer
 * is still to fill in SIXTY_JIAZI as the canonical source.)
 */
export function deriveJiaZiIndex(stem: HeavenlyStem, branch: EarthlyBranch): number {
  const k = `${stem}${branch}`;
  const idx = JIAZI_INDEX.get(k);
  if (idx === undefined) {
    todo('10', `(${stem}${branch}) not in SIXTY_JIAZI`);
  }
  return idx;
}
