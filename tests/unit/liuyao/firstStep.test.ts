/**
 * End-to-end first-step test: feed 6 bits through the deterministic
 * engine and assert that every field a downstream skill or the agent
 * would rely on is populated correctly:
 *
 *   - HEXAGRAMS table (all 64 hexagrams, all 8 宫 populated, palaceType
 *     sequence is 本宫→归魂 within each 宫)
 *   - hexagramSkill matches the bits to a known hexagram
 *   - palaceSkill returns the correct palace, palaceElement, palaceType,
 *     and shi/ying
 *   - najiaSkill fills stem/branch/element for all 6 lines
 *   - sixRelativeSkill derives the 六亲 from palaceElement + lineElement
 *   - sixGodSkill assigns the right 6 gods from the day stem
 *   - voidSkill marks the right lines as 旬空
 *   - chartAssembler wires all of the above into a single ChartResult
 *
 * This is the regression net for the "P0 first step" — the chart
 * assembler MUST produce a fully-decorated chart for any of the 64
 * hexagrams when the caller supplies bits + dayStem + dayBranch.
 */
import {
  HEXAGRAMS, HEXAGRAMS_BY_NAME, HEXAGRAMS_BY_BITS,
} from '../../../src/liuyao/constants/hexagrams';
import { PALACE_OF_TRIGRAM } from '../../../src/liuyao/constants/palaces';
import { XUNKONG_BY_DAY_STEM } from '../../../src/liuyao/constants/xunkong';
import { hexagramSkill } from '../../../src/liuyao/skills/hexagramSkill';
import { palaceSkill } from '../../../src/liuyao/skills/palaceSkill';
import { najiaSkill } from '../../../src/liuyao/skills/najiaSkill';
import { sixRelativeSkill } from '../../../src/liuyao/skills/sixRelativeSkill';
import { sixGodSkill } from '../../../src/liuyao/skills/sixGodSkill';
import { voidSkill } from '../../../src/liuyao/skills/voidSkill';
import { assembleChart } from '../../../src/liuyao/skills/chartAssembler';
import { castSkill } from '../../../src/liuyao/skills/castSkill';
import { yaoToBit, isMoving } from '../../../src/liuyao/constants/yao';

describe('64-hexagram table (from 64卦数据.json)', () => {
  it('has all 64 hexagrams in 文王 order', () => {
    expect(Object.keys(HEXAGRAMS)).toHaveLength(64);
    expect(Object.keys(HEXAGRAMS_BY_NAME)).toHaveLength(64);
    expect(Object.keys(HEXAGRAMS_BY_BITS)).toHaveLength(64);
  });

  it('each 宫 has exactly 8 hexagrams with the right palaceType sequence', () => {
    for (const palaceTrigram of ['乾','兑','离','震','巽','坎','艮','坤'] as const) {
      const palace = PALACE_OF_TRIGRAM[palaceTrigram];
      const members = Object.values(HEXAGRAMS).filter((h) => h.palace === palaceTrigram);
      expect(members).toHaveLength(8);
      const types = members.map((m) => m.palaceType);
      expect(types).toEqual(['本宫', '一世', '二世', '三世', '四世', '五世', '游魂', '归魂']);
      // 世/应 positions per type (from the data file + palace constants).
      // The 本宫 (e.g. 乾为天) has shi=6, ying=3.
      const head = members[0]!;
      // We can't import a shi/ying lookup here without re-deriving it,
      // but we can confirm the engine produces consistent output via
      // palaceSkill in the next test group.
      expect(head.palace).toBe(palaceTrigram);
    }
  });

  it('hexagramSkill matches a known static pattern (乾为天 = 111111)', () => {
    // 6 阳爻 (raw value 7 each).
    const r = hexagramSkill({ rawValues: [7, 7, 7, 7, 7, 7] });
    expect(r.originalHexagram?.name).toBe('乾');
    expect(r.changedHexagram?.name).toBe('乾');   // no moving lines
    expect(r.movingLines).toEqual([]);
    expect(r.originalHexagram?.palace).toBe('乾');
    expect(r.originalHexagram?.palaceType).toBe('本宫');
    expect(r.originalHexagram?.element).toBe('金');
  });

  it('hexagramSkill matches 雷水解 (010100) — used in design.md §14 example', () => {
    // 震 over 坎: 坎 bits = 010, 震 bits = 100 → engine bits (bottom-to-top) = 010100.
    // rawValues (8=阴, 7=阳) per line: 8,7,8,7,8,8.
    const r = hexagramSkill({ rawValues: [8, 7, 8, 7, 8, 8] });
    expect(r.originalHexagram?.name).toBe('解');
    expect(r.originalHexagram?.palace).toBe('震');
    expect(r.originalHexagram?.element).toBe('木');
  });

  it('hexagramSkill handles a moving-line pattern (9 at line 1 → 乾→姤)', () => {
    // Flipping line 1 of 乾 (111111 → 011111) gives 天风姤.
    const r = hexagramSkill({ rawValues: [9, 7, 7, 7, 7, 7] });
    expect(r.originalHexagram?.name).toBe('乾');
    expect(r.changedHexagram?.name).toBe('姤');
    expect(r.movingLines).toEqual([1]);
  });

  it('hexagramSkill: 9 at line 5 → 乾→大有', () => {
    // Flipping line 5 of 乾 (111111 → 111101) gives 火天大有.
    const r = hexagramSkill({ rawValues: [7, 7, 7, 7, 9, 7] });
    expect(r.originalHexagram?.name).toBe('乾');
    expect(r.changedHexagram?.name).toBe('大有');
    expect(r.movingLines).toEqual([5]);
  });
});

describe('palaceSkill', () => {
  it('returns the 宫 and 世/应 for 乾 (本宫)', () => {
    const r = palaceSkill({ originalHexagramName: '乾' });
    expect(r.palace).toBe('乾');
    expect(r.palaceElement).toBe('金');
    expect(r.palaceType).toBe('本宫');
    expect(r.shi).toBe(6);
    expect(r.ying).toBe(3);
  });

  it('returns the 宫 and 世/应 for 否 (三世, 乾宫)', () => {
    const r = palaceSkill({ originalHexagramName: '否' });
    expect(r.palace).toBe('乾');
    expect(r.palaceType).toBe('三世');
    expect(r.shi).toBe(3);
    expect(r.ying).toBe(6);
  });

  it('returns 游魂 (世=4) for 晋 (乾宫游魂)', () => {
    const r = palaceSkill({ originalHexagramName: '晋' });
    expect(r.palace).toBe('乾');
    expect(r.palaceType).toBe('游魂');
    expect(r.shi).toBe(4);
    expect(r.ying).toBe(1);
  });

  it('returns 归魂 (世=3) for 大有 (乾宫归魂)', () => {
    const r = palaceSkill({ originalHexagramName: '大有' });
    expect(r.palace).toBe('乾');
    expect(r.palaceType).toBe('归魂');
    expect(r.shi).toBe(3);
    expect(r.ying).toBe(6);
  });
});

describe('najiaSkill', () => {
  it('乾/乾 (乾为天): inner stems 甲, outer stems 壬; branches 子寅辰 午申戌', () => {
    const r = najiaSkill({ lowerTrigram: '乾', upperTrigram: '乾' });
    expect(r.lines.map((l) => l.stem)).toEqual(['甲', '甲', '甲', '壬', '壬', '壬']);
    expect(r.lines.map((l) => l.branch)).toEqual(['子', '寅', '辰', '午', '申', '戌']);
    // 5 elements are mixed: 子(水), 寅(木), 辰(土), 午(火), 申(金), 戌(土).
    expect(r.lines.map((l) => l.element)).toEqual(['水', '木', '土', '火', '金', '土']);
  });

  it('巽/乾 (天风姤): inner stems 辛, outer stems 壬', () => {
    const r = najiaSkill({ lowerTrigram: '巽', upperTrigram: '乾' });
    expect(r.lines.slice(0, 3).map((l) => l.stem)).toEqual(['辛', '辛', '辛']);
    expect(r.lines.slice(3).map((l) => l.stem)).toEqual(['壬', '壬', '壬']);
    // Inner branches for 巽: 丑, 亥, 酉
    expect(r.lines.slice(0, 3).map((l) => l.branch)).toEqual(['丑', '亥', '酉']);
  });
});

describe('sixRelativeSkill', () => {
  it('乾宫(金): line 子(水) should be 子孙 (我生者)', () => {
    // 乾宫 element is 金. 子 branch = 水. 我(金属)生 水 → 子孙.
    const r = sixRelativeSkill({ palaceElement: '金', lineElements: ['水', '木', '火', '土', '金', '水'] });
    expect(r.relatives[0]).toBe('子孙');   // 水: 我(金属)生 水
    expect(r.relatives[1]).toBe('妻财');   // 木: 我(金属)克 木
    expect(r.relatives[2]).toBe('官鬼');   // 火: 火克我(金属) → 官鬼
    expect(r.relatives[3]).toBe('父母');   // 土: 土生我(金属) → 父母
    expect(r.relatives[4]).toBe('兄弟');   // 金: 比和 → 兄弟
  });
});

describe('sixGodSkill', () => {
  it('甲日: starts at 青龙 at line 1', () => {
    const r = sixGodSkill({ dayStem: '甲' });
    expect(r.gods).toEqual(['青龙', '朱雀', '勾陈', '螣蛇', '白虎', '玄武']);
  });
  it('戊日: starts at 勾陈', () => {
    const r = sixGodSkill({ dayStem: '戊' });
    expect(r.gods[0]).toBe('勾陈');
  });
  it('己日: starts at 螣蛇', () => {
    const r = sixGodSkill({ dayStem: '己' });
    expect(r.gods[0]).toBe('螣蛇');
  });
});

describe('xunkong (旬空) — day stem → empty branches', () => {
  it('甲/己 → 戌亥', () => {
    expect(XUNKONG_BY_DAY_STEM['甲']).toEqual(['戌', '亥']);
    expect(XUNKONG_BY_DAY_STEM['己']).toEqual(['戌', '亥']);
  });
  it('乙/庚 → 申酉', () => {
    expect(XUNKONG_BY_DAY_STEM['乙']).toEqual(['申', '酉']);
    expect(XUNKONG_BY_DAY_STEM['庚']).toEqual(['申', '酉']);
  });
  it('丙/辛 → 午未', () => {
    expect(XUNKONG_BY_DAY_STEM['丙']).toEqual(['午', '未']);
    expect(XUNKONG_BY_DAY_STEM['辛']).toEqual(['午', '未']);
  });
});

describe('voidSkill', () => {
  it('甲日, 乾为天 (子/寅/辰/午/申/戌): only 戌 is in 戌亥 → line 6 is 旬空', () => {
    const r = voidSkill({
      dayStem: '甲',
      dayBranch: '子',
      lineBranches: ['子', '寅', '辰', '午', '申', '戌'],
    });
    expect(r.xunkong).toEqual(['戌', '亥']);
    expect(r.emptyLines).toEqual([6]);
  });

  it('乙日, 乾为天: 戌/亥 not in branches, but 申/酉 are — lines 5 (申) and 6 (戌 nope) → only line 5', () => {
    const r = voidSkill({
      dayStem: '乙',
      dayBranch: '子',
      lineBranches: ['子', '寅', '辰', '午', '申', '戌'],
    });
    expect(r.xunkong).toEqual(['申', '酉']);
    expect(r.emptyLines).toEqual([5]);   // 申
  });
});

describe('assembleChart — full first-step wiring', () => {
  it('乾为天, 甲日子时: produces a fully-decorated chart with no warnings', () => {
    // 6 阳爻 (raw 7 each, static). 乾/乾 → 乾为天 → 乾宫, 世6应3.
    // 甲日 → 青龙 at line 1, 朱雀 at line 2, ..., 玄武 at line 6.
    // 子时 + 甲子日 → 旬空 = 戌亥, line 6 (戌) is 旬空.
    const r = assembleChart({
      question: '求财',
      bits: [1, 1, 1, 1, 1, 1],
      dayStem: '甲',
      dayBranch: '子',
    });
    expect(r.warnings ?? []).toEqual([]);
    expect(r.originalHexagram.name).toBe('乾');
    expect(r.changedHexagram.name).toBe('乾');   // no moving lines
    expect(r.movingLines).toEqual([]);

    // 6 lines: positions 1..6, all 阳, none moving, stems 甲/甲/甲/壬/壬/壬.
    expect(r.lines.map((l) => l.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.lines.map((l) => l.stem)).toEqual(['甲', '甲', '甲', '壬', '壬', '壬']);
    expect(r.lines.map((l) => l.branch)).toEqual(['子', '寅', '辰', '午', '申', '戌']);
    expect(r.lines.map((l) => l.yinYang)).toEqual(['阳', '阳', '阳', '阳', '阳', '阳']);
    expect(r.lines.map((l) => l.moving)).toEqual([false, false, false, false, false, false]);

    // 世/应 — line 6 (戌) is 世, line 3 (辰) is 应.
    expect(r.lines[5]!.isShi).toBe(true);
    expect(r.lines[2]!.isYing).toBe(true);
    expect(r.lines[0]!.isShi).toBe(false);

    // 六神: 甲日起青龙, 顺序 青龙/朱雀/勾陈/螣蛇/白虎/玄武
    expect(r.lines.map((l) => l.sixGod)).toEqual(['青龙', '朱雀', '勾陈', '螣蛇', '白虎', '玄武']);

    // 六亲: 乾宫(金) vs each line's element. 金属 → 子(水)=子孙, 寅(木)=妻财,
    // 辰(土)=父母, 午(火)=官鬼, 申(金)=兄弟, 戌(土)=父母.
    expect(r.lines.map((l) => l.sixRelative)).toEqual(['子孙', '妻财', '父母', '官鬼', '兄弟', '父母']);

    // 旬空: 甲日 → 戌亥. Line 6 is 戌 → 旬空. Others not.
    expect(r.lines[5]!.void).toBe(true);
    expect(r.lines.slice(0, 5).map((l) => l.void)).toEqual([false, false, false, false, false]);
  });

  it('a moving-line chart: 9 at line 1 produces 乾→姤 (changed)', () => {
    const r = assembleChart({
      yaoValues: [9, 7, 7, 7, 7, 7] as any,
      dayStem: '甲',
      dayBranch: '子',
    });
    expect(r.movingLines).toEqual([1]);
    expect(r.originalHexagram.name).toBe('乾');
    expect(r.changedHexagram.name).toBe('姤');
  });

  it('produces a non-empty chart even with no dayStem (auto-derives from "now")', () => {
    // When no dayStem/dayBranch is supplied, chartAssembler now calls
    // calendarSkill to derive them from the current datetime. The
    // resulting chart is fully decorated (no warnings[] for the
    // calendar-derived path), with the 6 6-gods populated from the
    // current day stem and the xunkong marked.
    const r = assembleChart({ bits: [1, 1, 1, 1, 1, 1] });
    expect(r.originalHexagram.name).toBe('乾');
    // time block is populated, so the agent can see what day/month
    // the chart was cast on.
    expect(r.time).toBeDefined();
    expect(r.time?.dayStem).toBeDefined();
    expect(r.time?.dayBranch).toBeDefined();
    // No "dayStem not supplied" warning — calendarSkill covered it.
    expect(r.warnings ?? []).toEqual([]);
    // 6 6-gods populated (not the old default-to-青龙 path).
    expect(r.lines[0]?.sixGod).toBeDefined();
  });
});
