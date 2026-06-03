/**
 * 5.4 NaJia Skill — given upper + lower trigrams, return the 6 lines
 * with their stem, branch and element.
 *
 * Source: 装卦方法.md 装纳甲段 + 装纳甲歌诀. Knowledge complete.
 */
import type { NaJiaSkillInput, NaJiaSkillOutput, NaJiaLine } from '../types/skill';
import { najiaFor } from '../constants/najia';
import { BRANCH_ELEMENT } from '../constants/branches';
import type { LinePosition } from '../types/basic';

export function najiaSkill(input: NaJiaSkillInput): NaJiaSkillOutput {
  const positions: LinePosition[] = [1, 2, 3, 4, 5, 6];
  const lines = positions.map<NaJiaLine>((position) => {
    const isLower = position <= 3;
    const trigram = isLower ? input.lowerTrigram : input.upperTrigram;
    const { stem, branch } = najiaFor(trigram, position);
    return {
      position,
      stem,
      branch,
      element: BRANCH_ELEMENT[branch],
    };
  });
  return { lines: lines as [NaJiaLine, NaJiaLine, NaJiaLine, NaJiaLine, NaJiaLine, NaJiaLine] };
}
