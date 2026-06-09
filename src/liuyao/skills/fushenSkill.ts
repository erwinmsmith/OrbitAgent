/**
 * 5.13 FuShen Skill — 伏神 / 飞神.
 *
 * Source: docs/base_knowledge/飞伏神定例.md. The table fixes which
 * missing 六亲伏于 which line and preserves the classical wording.
 * Runtime stem/branch/element values are still derived from the same
 * NaJia + 六亲 functions used by the rest of the chart assembler.
 */
import type { FuShenItem, FuShenSkillInput, FuShenSkillOutput } from '../types/skill';
import type { LinePosition, SixRelative, WuXing } from '../types/basic';
import { bitsFromTrigrams } from '../constants/hexagrams';
import { WUXING_KE, WUXING_SHENG } from '../constants/wuxing';
import { najiaSkill } from './najiaSkill';
import { relativeOf } from '../constants/sixRelatives';

type FuShenRule = {
  bits: string;
  relative: SixRelative;
  position: LinePosition;
  classicalName: string;
};

const FUSHEN_RULES: readonly FuShenRule[] = [
  { bits: '011111', relative: '妻财', position: 2, classicalName: '飞来生伏得长生' },
  { bits: '001111', relative: '妻财', position: 2, classicalName: '伏去生飞，名为泄气' },
  { bits: '001111', relative: '子孙', position: 1, classicalName: '伏神入墓于飞爻' },
  { bits: '000111', relative: '子孙', position: 1, classicalName: '飞来克伏' },
  { bits: '000011', relative: '兄弟', position: 5, classicalName: '伏下长生遇引即出' },
  { bits: '000011', relative: '子孙', position: 1, classicalName: '飞来克伏' },
  { bits: '000001', relative: '兄弟', position: 5, classicalName: '伏去生飞，名为泄气' },
  { bits: '000101', relative: '子孙', position: 1, classicalName: '飞来克伏' },
  { bits: '001110', relative: '妻财', position: 2, classicalName: '伏去生飞，名为泄气' },
  { bits: '001010', relative: '妻财', position: 2, classicalName: '伏去生飞，名为泄气' },
  { bits: '001000', relative: '妻财', position: 2, classicalName: '伏去生飞，名为泄气' },
  { bits: '001100', relative: '妻财', position: 2, classicalName: '伏去生飞，名为泄气' },
  { bits: '001100', relative: '子孙', position: 4, classicalName: '伏克飞神为出暴' },
  { bits: '110100', relative: '子孙', position: 4, classicalName: '伏克飞神为出暴' },
  { bits: '001101', relative: '父母', position: 1, classicalName: '伏克飞神为出暴' },
  { bits: '001101', relative: '官鬼', position: 3, classicalName: '飞来生伏' },
  { bits: '011101', relative: '父母', position: 1, classicalName: '伏克飞神为出暴' },
  { bits: '010101', relative: '官鬼', position: 3, classicalName: '伏克飞神为出暴' },
  { bits: '010001', relative: '妻财', position: 4, classicalName: '飞来生伏' },
  { bits: '010011', relative: '官鬼', position: 3, classicalName: '伏克飞神为出暴' },
  { bits: '010011', relative: '妻财', position: 4, classicalName: '飞来生伏' },
  { bits: '010111', relative: '官鬼', position: 3, classicalName: '伏克飞神为出暴' },
  { bits: '000100', relative: '父母', position: 1, classicalName: '飞来克伏' },
  { bits: '010100', relative: '父母', position: 1, classicalName: '伏去生飞，名为泄气' },
  { bits: '011100', relative: '兄弟', position: 2, classicalName: '飞来生伏得长生' },
  { bits: '011000', relative: '兄弟', position: 2, classicalName: '飞来生伏得长生' },
  { bits: '011000', relative: '子孙', position: 4, classicalName: '伏去生飞，名为泄气' },
  { bits: '011010', relative: '兄弟', position: 2, classicalName: '飞来生伏得长生' },
  { bits: '011010', relative: '子孙', position: 4, classicalName: '伏克飞神为出暴' },
  { bits: '011110', relative: '兄弟', position: 2, classicalName: '飞来生伏得长生' },
  { bits: '011110', relative: '子孙', position: 4, classicalName: '伏神绝于飞爻' },
  { bits: '100110', relative: '子孙', position: 4, classicalName: '伏神绝于飞爻' },
  { bits: '111011', relative: '官鬼', position: 3, classicalName: '飞来生伏' },
  { bits: '101011', relative: '官鬼', position: 3, classicalName: '伏去生飞，名为泄气' },
  { bits: '100011', relative: '官鬼', position: 3, classicalName: '飞来生伏' },
  { bits: '100001', relative: '官鬼', position: 3, classicalName: '飞来生伏' },
  { bits: '100001', relative: '子孙', position: 5, classicalName: '飞来克伏' },
  { bits: '011001', relative: '子孙', position: 5, classicalName: '飞来克伏' },
  { bits: '100010', relative: '妻财', position: 3, classicalName: '伏去生飞，名为泄气' },
  { bits: '101010', relative: '妻财', position: 3, classicalName: '伏神绝于飞爻' },
  { bits: '101110', relative: '妻财', position: 3, classicalName: '伏神绝于飞爻' },
  { bits: '101000', relative: '妻财', position: 3, classicalName: '伏神绝于飞爻' },
  { bits: '101001', relative: '父母', position: 2, classicalName: '伏去生飞，名为泄气' },
  { bits: '101001', relative: '子孙', position: 3, classicalName: '伏去生飞，名为泄气' },
  { bits: '111001', relative: '父母', position: 2, classicalName: '飞来生伏得长生' },
  { bits: '111001', relative: '子孙', position: 3, classicalName: '飞来生伏' },
  { bits: '110001', relative: '子孙', position: 3, classicalName: '伏神入墓于飞爻' },
  { bits: '110101', relative: '妻财', position: 5, classicalName: '飞来克伏' },
  { bits: '110111', relative: '妻财', position: 5, classicalName: '飞来生伏得长生' },
  { bits: '110011', relative: '妻财', position: 5, classicalName: '伏神绝于飞爻' },
  { bits: '110011', relative: '子孙', position: 3, classicalName: '伏神入墓于飞爻' },
  { bits: '001011', relative: '妻财', position: 5, classicalName: '伏神绝于飞爻' },
  { bits: '100000', relative: '父母', position: 2, classicalName: '飞来生伏得长生' },
  { bits: '111000', relative: '父母', position: 2, classicalName: '飞来生伏得长生' },
  { bits: '111110', relative: '父母', position: 2, classicalName: '飞来生伏得长生' },
  { bits: '111010', relative: '父母', position: 2, classicalName: '飞来生伏得长生' },
];

export function fushenSkill(input: FuShenSkillInput): FuShenSkillOutput {
  const bits = bitsFromTrigrams(input.originalHexagram.upper, input.originalHexagram.lower);
  const rules = FUSHEN_RULES.filter((rule) => rule.bits === bits);
  if (rules.length === 0) return { hiddenGods: [] };

  const visibleSet = new Set(input.visibleRelatives);
  const originalNajia = najiaSkill({
    lowerTrigram: input.originalHexagram.lower,
    upperTrigram: input.originalHexagram.upper,
  }).lines;
  const pureNajia = najiaSkill({
    lowerTrigram: input.palacePureHexagram.lower,
    upperTrigram: input.palacePureHexagram.upper,
  }).lines;
  const pureRelatives = pureNajia.map((line) => relativeOf(input.originalHexagram.element, line.element));

  const hiddenGods = rules
    .filter((rule) => !visibleSet.has(rule.relative))
    .map<FuShenItem>((rule) => {
      const index = rule.position - 1;
      const fushen = pureNajia[index]!;
      const feishen = originalNajia[index]!;
      return {
        relative: rule.relative,
        fushenStem: fushen.stem,
        fushenBranch: fushen.branch,
        fushenElement: fushen.element,
        feishenRelative: input.visibleRelatives[index]!,
        feishenStem: feishen.stem,
        feishenBranch: feishen.branch,
        feishenElement: feishen.element,
        position: rule.position,
        relation: inferRelation(feishen.element, fushen.element),
        classicalName: rule.classicalName,
      };
    })
    .filter((item) => pureRelatives[item.position - 1] === item.relative);

  return { hiddenGods };
}

function inferRelation(feishen: WuXing, fushen: WuXing): FuShenItem['relation'] {
  if (feishen === fushen) return '飞伏比和';
  if (WUXING_SHENG[feishen] === fushen) return '飞生伏';
  if (WUXING_KE[feishen] === fushen) return '飞克伏';
  if (WUXING_SHENG[fushen] === feishen) return '伏生飞';
  return '伏克飞';
}
