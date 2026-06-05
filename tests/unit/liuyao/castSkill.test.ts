/**
 * Unit tests for the six-yang casting skill. Pure logic — no DB.
 */
import { castSkill } from '../../../src/liuyao/skills/castSkill';
import { threeCoinsToYaoValue, yaoYinYang, isMoving } from '../../../src/liuyao/constants/yao';

describe('castSkill (manual 0/1 → yao values)', () => {
  it('maps 0 → 8 (yin, static) and 1 → 7 (yang, static)', () => {
    const r = castSkill({ bits: [0, 1, 0, 1, 0, 1] });
    expect(r.rawValues).toEqual([8, 7, 8, 7, 8, 7]);
    expect(r.movingPositions).toEqual([]);
    expect(r.linesBottomToTop.map((l) => l.yinYang)).toEqual(['阴', '阳', '阴', '阳', '阴', '阳']);
  });

  it('rejects input that is not 6 bits', () => {
    expect(() => castSkill({ bits: [0, 1, 1] as any })).toThrow();
  });

  it('rejects when neither bits nor yaoValues is supplied', () => {
    expect(() => castSkill({} as any)).toThrow(/must supply/);
  });

  it('rejects when both bits and yaoValues are supplied', () => {
    expect(() => castSkill({ bits: [0,0,0,0,0,0], yaoValues: [7,7,7,7,7,7] } as any)).toThrow(/not both/);
  });
});

describe('castSkill (raw 6/7/8/9 yaoValues)', () => {
  it('passes yaoValues through unchanged', () => {
    const r = castSkill({ yaoValues: [7, 8, 9, 6, 7, 8] });
    expect(r.rawValues).toEqual([7, 8, 9, 6, 7, 8]);
    // Moving lines: 老阳(9) at position 3, 老阴(6) at position 4.
    expect(r.movingPositions).toEqual([3, 4]);
    expect(r.linesBottomToTop.map((l) => l.yinYang)).toEqual(['阳', '阴', '阳', '阴', '阳', '阴']);
  });

  it('rejects yaoValues with values outside 6/7/8/9', () => {
    expect(() => castSkill({ yaoValues: [7, 7, 7, 7, 7, 5] as any })).toThrow(/6\|7\|8\|9/);
  });
});

describe('threeCoinsToYaoValue (火珠林)', () => {
  it('3 backs → 6 (old yin, moving)', () => {
    expect(threeCoinsToYaoValue([0, 0, 0])).toBe(6);
  });
  it('3 faces → 9 (old yang, moving)', () => {
    expect(threeCoinsToYaoValue([1, 1, 1])).toBe(9);
  });
  it('1 face → 7 (少阳, static)', () => {
    expect(threeCoinsToYaoValue([0, 0, 1])).toBe(7);
  });
  it('2 faces → 8 (少阴, static)', () => {
    expect(threeCoinsToYaoValue([0, 1, 1])).toBe(8);
    expect(threeCoinsToYaoValue([1, 1, 0])).toBe(8);
  });
});

describe('yao helpers', () => {
  it('yaoYinYang', () => {
    expect(yaoYinYang(6)).toBe('阴');
    expect(yaoYinYang(7)).toBe('阳');
    expect(yaoYinYang(8)).toBe('阴');
    expect(yaoYinYang(9)).toBe('阳');
  });
  it('isMoving', () => {
    expect(isMoving(6)).toBe(true);
    expect(isMoving(9)).toBe(true);
    expect(isMoving(7)).toBe(false);
    expect(isMoving(8)).toBe(false);
  });
});
