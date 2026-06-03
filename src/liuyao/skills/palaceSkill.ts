/**
 * 5.3 Palace Skill — given a hexagram name, return its palace / palaceType
 * / world-line (世爻) / response-line (应爻).
 *
 * Pure derivation once HEXAGRAMS gives us palaceType.
 */
import type { PalaceSkillInput, PalaceSkillOutput } from '../types/skill';
import { HEXAGRAMS_BY_NAME, todo } from '../constants/hexagrams';
import { shiFor, yingFor } from '../constants/palaces';

export function palaceSkill(input: PalaceSkillInput): PalaceSkillOutput {
  const hex = HEXAGRAMS_BY_NAME[input.originalHexagramName];
  if (!hex) {
    todo('5', `palaceSkill: hexagram "${input.originalHexagramName}" not in HEXAGRAMS`);
  }
  return {
    palace: hex.palace,
    palaceElement: hex.element,
    palaceType: hex.palaceType,
    shi: shiFor(hex.palaceType),
    ying: yingFor(hex.palaceType),
  };
}
