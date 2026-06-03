/**
 * 5.11 Yongshen Skill — given question type, propose candidate yongshen.
 * Pure logic over the YONGSHEN_PRIMARY table.
 */
import type { YongshenSkillInput, YongshenSkillOutput } from '../types/skill';
import { YONGSHEN_AUXILIARY, YONGSHEN_PRIMARY } from '../constants/yongshen';
import type { LinePosition } from '../types/basic';

export function yongshenSkill(input: YongshenSkillInput): YongshenSkillOutput {
  const questionType = input.questionType ?? '其他';
  const primary = YONGSHEN_PRIMARY[questionType];
  const auxiliary = YONGSHEN_AUXILIARY[questionType];

  const findPositions = (rel: any): LinePosition[] =>
    (input.chart.lines as any)
      .filter((l: any) => l.sixRelative === rel)
      .map((l: any) => l.position as LinePosition);

  const candidates: any[] = [{
    relative: primary,
    positions: findPositions(primary),
    reason: `基于问题类型「${questionType}」自动推荐`,
    confidence: (findPositions(primary).length > 0 ? 'high' : 'medium') as any,
  }];
  if (auxiliary && auxiliary !== primary) {
    candidates.push({
      relative: auxiliary,
      positions: findPositions(auxiliary),
      reason: `辅助用神（问题类型「${questionType}」次选）`,
      confidence: 'medium',
    });
  }

  return { candidates };
}
