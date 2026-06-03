/**
 * 5.5 Six Relative Skill — given palace element and 6 line elements,
 * compute the 六亲 for each line. Pure logic.
 */
import type { SixRelativeSkillInput, SixRelativeSkillOutput } from '../types/skill';
import { relativeOf } from '../constants/sixRelatives';

export function sixRelativeSkill(input: SixRelativeSkillInput): SixRelativeSkillOutput {
  const relatives = input.lineElements.map((el) => relativeOf(input.palaceElement, el));
  return { relatives: relatives as any };
}
