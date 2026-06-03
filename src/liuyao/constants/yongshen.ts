/**
 * Yongshen (用神) rules — which 六亲 to focus on for each question
 * type. ✅ Knowledge base lists these in design.md §5.11.
 */
import type { QuestionType, SixRelative } from '../types/basic';

export const YONGSHEN_PRIMARY: Record<QuestionType, SixRelative> = {
  '求财':     '妻财',
  '求事业':   '官鬼',
  '求感情':   '官鬼',   // 模糊：男女有别，看 chart.shi 看世爻阴阳决定
  '求考试':   '父母',
  '求合同':   '父母',
  '求健康':   '官鬼',   // 鬼为病，孙为药
  '求失物':   '妻财',
  '求出行':   '官鬼',   // 出行多看官鬼/世爻；此处用官鬼作 fallback
  '求合作':   '官鬼',
  '求官司':   '官鬼',
  '求宠物':   '子孙',
  '其他':     '官鬼',   // 默认看官鬼
};

/** Some question types have a 辅助 (auxiliary) yongshen. */
export const YONGSHEN_AUXILIARY: Partial<Record<QuestionType, SixRelative>> = {
  '求事业':   '父母',   // 文书、职位
  '求考试':   '官鬼',   // 名次、录取
  '求合同':   '官鬼',
  '求健康':   '子孙',   // 药
};

/** 六亲 (relatives) that an yongshen in question is sensitive to. */
export function yongshenFor(question: QuestionType, _chart: unknown): SixRelative {
  return YONGSHEN_PRIMARY[question];
}
