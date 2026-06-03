/**
 * 5.9 Void Skill — given day pillar, mark which lines are 旬空.
 */
import type { VoidSkillInput, VoidSkillOutput } from '../types/skill';
import { xunkongForDayStem, todo } from '../constants/xunkong';

export function voidSkill(input: VoidSkillInput): VoidSkillOutput {
  const xunkong = xunkongForDayStem(input.dayStem);
  const emptyLines = input.lineBranches
    .map((b, i) => (xunkong[0] === b || xunkong[1] === b ? (i + 1) as any : null))
    .filter((p): p is any => p !== null);
  return { xunkong, emptyLines };
}
