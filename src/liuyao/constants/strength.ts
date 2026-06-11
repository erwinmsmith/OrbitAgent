/**
 * Strength (旺衰) labels — assigned per line based on the month and
 * day branches. Standard 旺相休囚死 rules from
 * docs/base_knowledge/六爻卦理.md §1.
 *
 * Implementation boundary:
 *   - 月建 determines 旺/相/休/囚/死 and 月破.
 *   - 日辰 determines 得日扶/得日生/被日克 and 日破.
 *   - 旬空 is added by strengthSkill from the already-computed line.void.
 *
 * Seasonal rule: the month element is 旺; what it produces is 相;
 * what produces it is 休; what overcomes it is 囚; what it overcomes
 * is 死. 土 follows 辰戌丑未 month.
 */
import type { EarthlyBranch, WuXing } from '../types/basic';
import type { LineStrengthLabel } from '../types/skill';
import { BRANCH_CLASH, BRANCH_ELEMENT } from './branches';
import { WUXING_KE, WUXING_SHENG, overcomesOf, producesOf } from './wuxing';

export const STRENGTH_LABELS: ReadonlyArray<LineStrengthLabel> = [
  '旺', '相', '休', '囚', '死',
  '月破', '日破', '旬空',
  '得日生', '得月生', '得日扶', '得月扶', '被日克', '被月克',
] as const;

export const MONTH_STRENGTH_SCORE: Record<'旺' | '相' | '休' | '囚' | '死', number> = {
  旺: 3,
  相: 2,
  休: 0,
  囚: -1,
  死: -2,
};

export const RELATION_STRENGTH_SCORE: Partial<Record<LineStrengthLabel, number>> = {
  得月生: 2,
  得月扶: 2,
  被月克: -2,
  得日生: 1,
  得日扶: 1,
  被日克: -1,
  月破: -3,
  日破: -2,
  旬空: -1,
};

export function monthStrengthForElement(
  lineElement: WuXing,
  monthBranch: EarthlyBranch,
): '旺' | '相' | '休' | '囚' | '死' {
  const monthElement = BRANCH_ELEMENT[monthBranch];
  if (lineElement === monthElement) return '旺';
  if (lineElement === WUXING_SHENG[monthElement]) return '相';
  if (lineElement === producesOf(monthElement)) return '休';
  if (lineElement === overcomesOf(monthElement)) return '囚';
  return '死';
}

export function elementRelationLabels(
  lineElement: WuXing,
  pillarElement: WuXing,
  kind: '月' | '日',
): LineStrengthLabel[] {
  if (lineElement === pillarElement) return [kind === '月' ? '得月扶' : '得日扶'];
  if (WUXING_SHENG[pillarElement] === lineElement) return [kind === '月' ? '得月生' : '得日生'];
  if (WUXING_KE[pillarElement] === lineElement) return [kind === '月' ? '被月克' : '被日克'];
  return [];
}

export function scoreStrengthLabels(labels: LineStrengthLabel[]): number {
  return labels.reduce((score, label) => {
    if (label === '旺' || label === '相' || label === '休' || label === '囚' || label === '死') {
      return score + MONTH_STRENGTH_SCORE[label];
    }
    return score + (RELATION_STRENGTH_SCORE[label] ?? 0);
  }, 0);
}

export function strengthLabelsForLine(
  lineBranch: EarthlyBranch,
  monthBranch: EarthlyBranch | undefined,
  dayBranch: EarthlyBranch | undefined,
): LineStrengthLabel[] {
  const lineElement = BRANCH_ELEMENT[lineBranch];
  const labels: LineStrengthLabel[] = [];

  if (monthBranch) {
    const monthElement = BRANCH_ELEMENT[monthBranch];
    labels.push(monthStrengthForElement(lineElement, monthBranch));
    labels.push(...elementRelationLabels(lineElement, monthElement, '月'));
    if (BRANCH_CLASH[lineBranch] === monthBranch) labels.push('月破');
  }

  if (dayBranch) {
    const dayElement = BRANCH_ELEMENT[dayBranch];
    labels.push(...elementRelationLabels(lineElement, dayElement, '日'));
    if (BRANCH_CLASH[lineBranch] === dayBranch) labels.push('日破');
  }

  return labels;
}
