/**
 * 十二长生定局表。
 *
 * Source: docs/base_knowledge/十二长生资料汇编.md §2.
 * 六爻按五行分组取局：金、木、水土、火；土随水同宫。
 * This table is only an auxiliary line state, not a standalone
 * auspicious/inauspicious judgement.
 */
import type { EarthlyBranch, WuXing } from '../types/basic';
import type { TwelveStage } from '../types/skill';

export const TWELVE_STAGE_ORDER: TwelveStage[] = [
  '长生', '沐浴', '冠带', '临官', '帝旺', '衰',
  '病', '死', '墓', '绝', '胎', '养',
];

export type TwelveStageGroup = '金' | '木' | '水土' | '火';

export const TWELVE_STAGE_BY_GROUP: Record<TwelveStageGroup, Record<EarthlyBranch, TwelveStage>> = {
  金: {
    子: '死', 丑: '墓', 寅: '绝', 卯: '胎', 辰: '养', 巳: '长生',
    午: '沐浴', 未: '冠带', 申: '临官', 酉: '帝旺', 戌: '衰', 亥: '病',
  },
  木: {
    子: '沐浴', 丑: '冠带', 寅: '临官', 卯: '帝旺', 辰: '衰', 巳: '病',
    午: '死', 未: '墓', 申: '绝', 酉: '胎', 戌: '养', 亥: '长生',
  },
  水土: {
    子: '帝旺', 丑: '衰', 寅: '病', 卯: '死', 辰: '墓', 巳: '绝',
    午: '胎', 未: '养', 申: '长生', 酉: '沐浴', 戌: '冠带', 亥: '临官',
  },
  火: {
    子: '胎', 丑: '养', 寅: '长生', 卯: '沐浴', 辰: '冠带', 巳: '临官',
    午: '帝旺', 未: '衰', 申: '病', 酉: '死', 戌: '墓', 亥: '绝',
  },
};

export const TWELVE_STAGE_CORE = new Set<TwelveStage>(['长生', '帝旺', '墓', '绝']);

export function twelveStageGroupForElement(element: WuXing): TwelveStageGroup {
  return element === '水' || element === '土' ? '水土' : element;
}

export function twelveStageFor(element: WuXing, branch: EarthlyBranch): TwelveStage {
  return TWELVE_STAGE_BY_GROUP[twelveStageGroupForElement(element)][branch];
}

export function twelveStageNote(stage: TwelveStage): string | undefined {
  switch (stage) {
    case '长生':
      return '生发有气，仍须结合用神身份与生克制化';
    case '帝旺':
      return '气势较足，不能替代月令旺衰总判';
    case '墓':
      return '藏滞入库，需看冲开、旺衰与回头生克';
    case '绝':
      return '气机难续，需看生扶、长生与原神救助';
    default:
      return undefined;
  }
}
