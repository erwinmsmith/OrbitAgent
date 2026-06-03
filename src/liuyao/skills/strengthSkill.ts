/**
 * 5.10 Strength Skill — compute 旺/相/休/囚/死/月破/日破/旬空 per line.
 *
 * Status: NOT YET FILLED IN. Knowledge base has the rules but no
 * structured 旺衰 lookup; we throw and let the assembler skip this.
 */
import type { StrengthSkillInput, StrengthSkillOutput } from '../types/skill';
import { todo } from '../constants/strength';
import { BRANCH_CLASH } from '../constants/branches';

export function strengthSkill(input: StrengthSkillInput): StrengthSkillOutput {
  // We can compute a partial result: 月破 / 日破 (just the branch-clash
  // check). The other labels require a 旺衰 lookup table (§14).
  const lineStrengths = input.lines.map((line) => {
    const labels: any[] = [];
    if (input.monthBranch && BRANCH_CLASH[line.branch] === input.monthBranch) labels.push('月破');
    if (input.dayBranch && BRANCH_CLASH[line.branch] === input.dayBranch) labels.push('日破');
    return { position: line.position, labels };
  });

  // If no month/day branch supplied, or no 旺衰 lookup is available, throw
  // an explicit error so the assembler knows to omit this field.
  todo('14', 'strengthSkill: 旺/相/休/囚/死 labels (and 旬空) — §14');
  return { lineStrengths: lineStrengths as any };
}
