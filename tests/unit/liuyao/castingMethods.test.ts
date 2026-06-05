import {
  castFromCharacter,
  castFromCoins,
  castFromManual,
  castFromNumbers,
  castFromTime,
  coinThrowToYaoValue,
} from '../../../src/liuyao/casting/methods';

describe('casting methods', () => {
  it('maps three coins by 正=3 and 反=2', () => {
    expect(coinThrowToYaoValue(['反', '反', '反'])).toBe(6);
    expect(coinThrowToYaoValue(['正', '反', '反'])).toBe(7);
    expect(coinThrowToYaoValue(['正', '正', '反'])).toBe(8);
    expect(coinThrowToYaoValue(['正', '正', '正'])).toBe(9);
  });

  it('casts six explicit coin throws bottom-to-top', () => {
    const r = castFromCoins([
      ['正', '反', '反'],
      ['正', '正', '正'],
      ['正', '反', '反'],
      ['正', '反', '反'],
      ['反', '反', '反'],
      ['正', '反', '反'],
    ]);
    expect(r.yaoValues).toEqual([7, 9, 7, 7, 6, 7]);
    expect(r.movingLines).toEqual([2, 5]);
    expect(r.meta.sums).toEqual([7, 9, 7, 7, 6, 7]);
  });

  it('keeps manual yaoValues and maps manual bits to static yaoValues', () => {
    expect(castFromManual({ yaoValues: [7, 8, 9, 6, 7, 8] }).yaoValues).toEqual([7, 8, 9, 6, 7, 8]);
    expect(castFromManual({ bits: [1, 0, 1, 0, 1, 0] }).yaoValues).toEqual([7, 8, 7, 8, 7, 8]);
  });

  it('casts by time with xiantian trigram numbers and one moving line', () => {
    const r = castFromTime('2026-06-04T18:45:00+08:00', 'Asia/Shanghai');
    expect(r.meta.upperTrigram).toBe('震');
    expect(r.meta.lowerTrigram).toBe('坎');
    expect(r.meta.movingLine).toBe(6);
    expect(r.yaoValues).toEqual([8, 7, 8, 7, 8, 6]);
  });

  it('casts by three reported numbers', () => {
    const r = castFromNumbers([2, 9, 5]);
    expect(r.meta.upperTrigram).toBe('兑');
    expect(r.meta.lowerTrigram).toBe('乾');
    expect(r.meta.movingLine).toBe(5);
    expect(r.yaoValues).toEqual([7, 7, 7, 7, 9, 8]);
  });

  it('casts by character strokes with current time as auxiliary numbers', () => {
    const r = castFromCharacter('财', '2026-06-04T18:45:00+08:00', 'Asia/Shanghai');
    expect(r.meta.basisSource).toBe('modern-stroke-dictionary');
    expect(r.meta.strokeCount).toBe(7);
    expect(r.meta.upperTrigram).toBe('艮');
    expect(r.meta.lowerTrigram).toBe('乾');
    expect(r.meta.movingLine).toBe(3);
    expect(r.yaoValues).toEqual([7, 7, 9, 8, 8, 7]);
  });
});
