/**
 * 5.2 Hexagram Skill — given 6 yao values, produce:
 *   - originalLines / changedLines (bit arrays)
 *   - the matching original hexagram + changed hexagram
 *   - moving-line positions
 *
 * Relies on:
 *   - HEXAGRAMS table   (constants/hexagrams.ts)  — ⚠ MISSING (§5)
 *   - bitsFromTrigrams (constants/hexagrams.ts)  — derived from TRIGRAM_BITS
 */
import type { HexagramSkillInput, HexagramSkillOutputT as HexagramSkillOutput } from '../types/skill';
import { flipYao, isMoving, yaoToBit } from '../constants/yao';
import { BITS_TO_TRIGRAM, TRIGRAM_BITS } from '../constants/trigrams';
import { HEXAGRAMS_BY_BITS, bitsFromTrigrams, todo } from '../constants/hexagrams';
import type { YinYangBit } from '../types/basic';

export function hexagramSkill(input: HexagramSkillInput): HexagramSkillOutput {
  const originalBits = input.rawValues.map(yaoToBit);
  const changedBits: YinYangBit[] = input.rawValues.map((v) => yaoToBit(flipYao(v)));
  const originalKey = originalBits.join('');
  const changedKey = changedBits.join('');

  const originalHex = HEXAGRAMS_BY_BITS[originalKey] ?? null;
  const changedHex = HEXAGRAMS_BY_BITS[changedKey] ?? null;
  if (!originalHex) {
    // TODO §5 — once HEXAGRAMS is filled in this branch will only fire
    // for genuinely unknown bit patterns (shouldn't happen for valid
    // 6-line sequences).
    todo('5', `hexagram not found for bit pattern ${originalKey}`);
  }
  if (!changedHex) {
    todo('5', `changed hexagram not found for bit pattern ${changedKey}`);
  }
  const movingLines = input.rawValues
    .map((v, i) => (isMoving(v) ? (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 : null))
    .filter((p): p is 1 | 2 | 3 | 4 | 5 | 6 => p !== null);

  return {
    originalLines: originalBits as [YinYangBit, YinYangBit, YinYangBit, YinYangBit, YinYangBit, YinYangBit],
    changedLines:  changedBits  as [YinYangBit, YinYangBit, YinYangBit, YinYangBit, YinYangBit, YinYangBit],
    originalHexagram: originalHex,
    changedHexagram: changedHex,
    movingLines,
  };
}

/** Re-export for the few callers that want the bit→trigram helper. */
export { bitsFromTrigrams, BITS_TO_TRIGRAM, TRIGRAM_BITS };
