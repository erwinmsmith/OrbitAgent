/**
 * Strength (旺衰) labels — assigned per line based on the month and
 * day branches. Standard 旺相休囚死 rules from
 * docs/base_knowledge/六爻卦理.md §1.
 *
 * Status: NOT YET FILLED IN. The high-level algorithm is:
 *   - Element 与 月支 同  → 旺 (especially in its own season)
 *   - Element 与 月支 同行 (e.g. same 五行 group)  → 相
 *   - Element 与 月支  被 月支所克 → 休
 *   - Element 与 月支  克 月支 → 囚
 *   - Element 与 月支  所克 → 死
 *
 * But the precise per-month/season table isn't in the knowledge base
 * as a single lookup. See KNOWLEDGE_NEEDED.md §14.
 */
import type { EarthlyBranch } from '../types/basic';
import type { LineStrengthLabel } from '../types/skill';
import { todo } from './todo';
export { todo };

export const STRENGTH_LABELS: ReadonlyArray<LineStrengthLabel> = [
  '旺', '相', '休', '囚', '死',
  '月破', '日破', '旬空',
  '得日生', '得月生', '得日扶', '得月扶', '被日克', '被月克',
] as const;

export function strengthLabelsForLine(
  _lineBranch: EarthlyBranch,
  _monthBranch: EarthlyBranch | undefined,
  _dayBranch: EarthlyBranch | undefined,
): LineStrengthLabel[] {
  // TODO §14 — see KNOWLEDGE_NEEDED.md
  todo('14', 'strengthLabelsForLine — derive 旺/相/休/囚/死/月破/日破/...');
}
