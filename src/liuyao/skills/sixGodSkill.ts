/**
 * 5.6 Six God Skill — given day stem, return the 6 gods for the
 * six lines starting from 初爻.
 */
import type { SixGodSkillInput, SixGodSkillOutput } from '../types/skill';
import { sixGodsForDayStem } from '../constants/sixGods';

export function sixGodSkill(input: SixGodSkillInput): SixGodSkillOutput {
  return { gods: sixGodsForDayStem(input.dayStem) };
}
