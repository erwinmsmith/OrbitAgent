/**
 * 5.11 Yongshen Skill — given question type, propose candidate yongshen.
 * Pure logic over the deterministic yongshen rule table.
 */
import type { YongshenSkillInput, YongshenSkillOutput } from '../types/skill';
import { type YongshenFocus, yongshenRuleFor } from '../constants/yongshen';
import { detectQuestionType } from '../agent/questionClassifier';
import type { LinePosition, SixRelative } from '../types/basic';

export function yongshenSkill(input: YongshenSkillInput): YongshenSkillOutput {
  const questionType = detectQuestionType(input.question, input.questionType);
  const rule = yongshenRuleFor(questionType);

  const findPositions = (focus: YongshenFocus): LinePosition[] => {
    if (focus === '世爻') {
      return (input.chart.lines as any)
        .filter((l: any) => l.isShi)
        .map((l: any) => l.position as LinePosition);
    }
    if (focus === '应爻') {
      return (input.chart.lines as any)
        .filter((l: any) => l.isYing)
        .map((l: any) => l.position as LinePosition);
    }
    return (input.chart.lines as any)
      .filter((l: any) => l.sixRelative === focus)
      .map((l: any) => l.position as LinePosition);
  };

  const candidates: any[] = [];
  const pushCandidate = (focus: YongshenFocus, primary: boolean) => {
    if (candidates.some((candidate) => candidate.relative === focus)) return;
    const positions = findPositions(focus);
    candidates.push({
      relative: focus,
      positions,
      reason: `${primary ? '主要用神' : '辅助关注'}：${rule.description}`,
      confidence: (primary && positions.length > 0 ? 'high' : positions.length > 0 ? 'medium' : 'low') as any,
    });
  };

  for (const focus of rule.primary) pushCandidate(focus, true);
  for (const focus of rule.auxiliary) pushCandidate(focus, false);

  const primaryRelatives = rule.primary.filter((focus): focus is SixRelative =>
    focus !== '世爻' && focus !== '应爻',
  );
  const supportingGods = primaryRelatives.flatMap((relative) =>
    deriveSupportingGods(relative, input.chart.lines as any),
  );
  const hostileGods = primaryRelatives.flatMap((relative) =>
    deriveHostileGods(relative, input.chart.lines as any),
  );

  return {
    candidates,
    supportingGods,
    hostileGods,
  };
}

function positionsOf(relative: SixRelative, lines: any[]): LinePosition[] {
  return lines
    .filter((l: any) => l.sixRelative === relative)
    .map((l: any) => l.position as LinePosition);
}

function deriveSupportingGods(relative: SixRelative, lines: any[]) {
  const yuanshen = ({
    '父母': '官鬼',
    '官鬼': '妻财',
    '妻财': '子孙',
    '子孙': '兄弟',
    '兄弟': '父母',
  } as const)[relative];
  const positions = positionsOf(yuanshen, lines);
  return positions.length ? [{ relative: yuanshen, positions, role: '元神' as const }] : [];
}

function deriveHostileGods(relative: SixRelative, lines: any[]) {
  const jishen = ({
    '父母': '妻财',
    '官鬼': '子孙',
    '妻财': '兄弟',
    '子孙': '父母',
    '兄弟': '官鬼',
  } as const)[relative];
  const choushen = ({
    '父母': '子孙',
    '官鬼': '兄弟',
    '妻财': '父母',
    '子孙': '官鬼',
    '兄弟': '妻财',
  } as const)[relative];
  return [
    positionsOf(jishen, lines).length
      ? { relative: jishen, positions: positionsOf(jishen, lines), role: '忌神' as const }
      : null,
    positionsOf(choushen, lines).length
      ? { relative: choushen, positions: positionsOf(choushen, lines), role: '仇神' as const }
      : null,
  ].filter(Boolean) as Array<{ relative: SixRelative; positions: LinePosition[]; role: '忌神' | '仇神' }>;
}
