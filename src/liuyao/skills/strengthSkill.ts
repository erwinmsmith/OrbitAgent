/**
 * 5.10 Strength Skill — compute 旺/相/休/囚/死/月破/日破/旬空 per line.
 *
 * The output is deterministic pre-interpretation material: it gives
 * the agent month strength, day/month support or overcoming, and
 * broken/void tags. It does not make the final auspicious judgement.
 */
import type { LineStrengthLabel, StrengthSkillInput, StrengthSkillOutput } from '../types/skill';
import { scoreStrengthLabels, strengthLabelsForLine } from '../constants/strength';

export function strengthSkill(input: StrengthSkillInput): StrengthSkillOutput {
  const lineStrengths = input.lines.map((line) => {
    const labels: LineStrengthLabel[] = strengthLabelsForLine(
      line.branch,
      input.monthBranch,
      input.dayBranch,
    );
    if (line.void) labels.push('旬空');
    const deduped = Array.from(new Set(labels));
    return {
      position: line.position,
      labels: deduped,
      score: scoreStrengthLabels(deduped),
    };
  });
  return { lineStrengths };
}
