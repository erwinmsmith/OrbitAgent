/**
 * 5.1 Casting Skill — convert 6 inputs into six 爻值 (YaoValue 6/7/8/9)
 * + moving-line positions.
 *
 * Three input modes are supported:
 *
 *   1. `bits` (manual): 0/1 yin/yang per line. The most common input
 *      for the CLI — `orbit divination chart 0 1 1 0 1 1`. Static:
 *      0 → 阴(8), 1 → 阳(7), no 老阳/老阴.
 *
 *   2. `yaoValues` (raw): explicit 6/7/8/9 per line. Used when the
 *      user has already done the 3-coin derivation themselves, or
 *      when they want to feed moving lines (6/9). E.g. the CLI's
 *      `orbit divination chart --yao 7 7 9 7 8 6` would pass
 *      [7,7,9,7,8,6] as yaoValues.
 *
 *   3. `coins` (3-coin 火珠林): the assistant calls threeCoinsToYaoValue
 *      in constants/yao.ts to derive each 爻值, but we don't accept
 *      the raw 18-bit coin stream through this function — it's a
 *      pure CLI-layer helper.
 *
 * Mutual-exclusion: exactly one of bits or yaoValues must be supplied.
 */
import type { CastSkillInput, CastSkillOutput } from '../types/skill';
import { LINE_POSITIONS, isMoving, yaoYinYang } from '../constants/yao';
import type { LinePosition, YaoValue, YinYang } from '../types/basic';

export function castSkill(input: CastSkillInput): CastSkillOutput {
  const hasBits = Array.isArray(input.bits);
  const hasYao = Array.isArray(input.yaoValues);
  if (hasBits && hasYao) {
    throw new Error('castSkill: pass either `bits` OR `yaoValues`, not both');
  }
  if (!hasBits && !hasYao) {
    throw new Error('castSkill: must supply `bits` (6 × 0/1) or `yaoValues` (6 × 6/7/8/9)');
  }

  let rawValues: YaoValue[];
  if (hasBits) {
    if ((input.bits as any).length !== 6) {
      throw new Error(`castSkill: bits expects 6 entries, got ${(input.bits as any).length}`);
    }
    // 0 → 阴 (8), 1 → 阳 (7). Static, no moving lines.
    rawValues = (input.bits as ReadonlyArray<0 | 1>).map((b) => (b === 1 ? 7 : 8));
  } else {
    if ((input.yaoValues as any).length !== 6) {
      throw new Error(`castSkill: yaoValues expects 6 entries, got ${(input.yaoValues as any).length}`);
    }
    for (const v of input.yaoValues as ReadonlyArray<number>) {
      if (v !== 6 && v !== 7 && v !== 8 && v !== 9) {
        throw new Error(`castSkill: yaoValue must be 6|7|8|9, got ${v}`);
      }
    }
    rawValues = (input.yaoValues as ReadonlyArray<YaoValue>).slice() as YaoValue[];
  }

  const linesBottomToTop: { position: LinePosition; value: YaoValue; yinYang: YinYang; moving: boolean }[] = [];
  for (let i = 0; i < 6; i++) {
    const pos = LINE_POSITIONS[i]!;
    const v = rawValues[i]!;
    linesBottomToTop.push({ position: pos, value: v, yinYang: yaoYinYang(v), moving: isMoving(v) });
  }
  const movingPositions = linesBottomToTop.filter((l) => l.moving).map((l) => l.position);

  return {
    rawValues: rawValues as [YaoValue, YaoValue, YaoValue, YaoValue, YaoValue, YaoValue],
    linesBottomToTop,
    movingPositions,
  };
}
