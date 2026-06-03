/**
 * Question classifier (per design.md §8 Step A). Maps a free-text
 * user question to one of the supported QuestionType values via a
 * keyword heuristic. The Agent may refine this; the LLM-backed
 * classifier lives in a future revision.
 */
import type { QuestionType } from '../types/basic';

const KEYWORDS: Array<[QuestionType, RegExp]> = [
  ['求财',    /钱|财|收入|生意|投资|亏损|分红/],
  ['求事业',  /事业|工作|升职|求职|面试|公司|创业/],
  ['求感情',  /感情|爱情|婚姻|分手|对象|桃花|对象|男友|女友|老公|老婆/],
  ['求考试',  /考试|考|高考|考研|面试|测试|认证/],
  ['求合同',  /合同|签约|协议|签约|订单/],
  ['求健康',  /健康|病|身体|康复|治疗|医院/],
  ['求失物',  /丢|失物|找|寻找/],
  ['求出行',  /出行|远行|搬家|出差|旅游/],
  ['求合作',  /合作|合伙|谈判|签|联名/],
  ['求官司',  /官司|诉讼|法律|起诉|法院/],
  ['求宠物',  /宠物|猫|狗|鸟|鱼/],
];

export function detectQuestionType(question?: string): QuestionType {
  if (!question) return '其他';
  for (const [t, re] of KEYWORDS) if (re.test(question)) return t;
  return '其他';
}

export function missingContextFor(question?: string): string[] {
  const missing: string[] = [];
  if (!question || question.trim().length < 4) {
    missing.push('问题描述太短或缺失');
  }
  return missing;
}
