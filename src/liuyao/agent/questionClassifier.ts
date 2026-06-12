/**
 * Question classifier. It maps free-text questions to the deterministic
 * yongshen rule table. The LLM may refine wording later, but it must not
 * override a user-selected question type without saying why.
 */
import type { QuestionType } from '../types/basic';
import { normalizeQuestionType, YONGSHEN_RULES } from '../constants/yongshen';

export function detectQuestionType(question?: string, explicitType?: string): QuestionType {
  if (explicitType && explicitType.trim()) return normalizeQuestionType(explicitType);
  const text = String(question ?? '').toLowerCase();
  if (!text.trim()) return '玄学问事泛问';

  let best: { type: QuestionType; score: number } | null = null;
  for (const rule of YONGSHEN_RULES) {
    const score = rule.keywords.reduce((sum, keyword) => {
      const normalizedKeyword = keyword.toLowerCase();
      return text.includes(normalizedKeyword) ? sum + Math.max(1, normalizedKeyword.length) : sum;
    }, 0);
    if (score > 0 && (!best || score > best.score)) {
      best = { type: rule.type, score };
    }
  }
  return best?.type ?? '玄学问事泛问';
}

export function missingContextFor(question?: string): string[] {
  const missing: string[] = [];
  if (!question || question.trim().length < 4) {
    missing.push('问题描述太短或缺失');
  }
  return missing;
}
