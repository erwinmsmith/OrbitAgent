/**
 * 5.1 Casting Skill — convert 6 raw bits into six 爻值 + moving lines.
 *
 * MVP path: `bits[i] = 0|1` is the yin/yang bit for line i+1
 * (1-indexed, bottom-to-top). 1=阳 (becomes 7 少阳, static), 0=阴
 * (becomes 8 少阴, static). No moving lines in the manual path.
 *
 * 火珠林 3-coin derivation (where 6/7/8/9 come from the sum of three
 * 0|1 bits) is also wired but only as a separate helper — see
 * threeCoinsToYaoValue() in constants/yao.ts.
 */
import type { CastSkillInput, CastSkillOutput } from '../types/skill';
import { LINE_POSITIONS, isMoving, yaoYinYang } from '../constants/yao';
import type { LinePosition, YaoValue, YinYang } from '../types/basic';

export function castSkill(input: CastSkillInput): CastSkillOutput {
  if (!input.bits || (input.bits as any).length !== 6) {
    throw new Error(`castSkill expects 6 bits, got ${(input.bits as any)?.length}`);
  }
  const mode = input.interpretation ?? 'manual';

  if (mode === 'coin') {
    // The 火珠林 path takes 3 coins per throw, so 18 bits total. We don't
    // accept this through the current shape (which is 6 bits); throw a
    // clear error so callers reach for the manual path.
    throw new Error(
      'castSkill interpretation=coin not supported in MVP — pass 6 bits (one per line) ' +
      'with the manual interpretation instead. To derive 6/7/8/9 from three coins, ' +
      'use the helper threeCoinsToYaoValue() in src/liuyao/constants/yao.ts.',
    );
  }

  // manual mode: 0 → 阴 (8), 1 → 阳 (7). Static, no moving lines.
  const rawValues: YaoValue[] = input.bits.map((b) => (b === 1 ? 7 : 8));

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
