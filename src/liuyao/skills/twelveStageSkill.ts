/**
 * Twelve Stage Skill — annotate each line with 十二长生.
 *
 * Source: docs/base_knowledge/十二长生资料汇编.md.
 * Boundary: only 日辰 and moving-line changed branch are annotated.
 * 月建 still belongs to 旺衰/月破/生克 judgement and must not be
 * mechanically read as 十二长生吉凶.
 */
import type { TwelveStageSkillInput, TwelveStageSkillOutput } from '../types/skill';
import { TWELVE_STAGE_CORE, twelveStageFor, twelveStageNote } from '../constants/twelveStages';

export function twelveStageSkill(input: TwelveStageSkillInput): TwelveStageSkillOutput {
  const lineStages = input.lines.map((line) => {
    const byDay = input.dayBranch
      ? twelveStageFor(line.element, input.dayBranch)
      : undefined;
    const byChangedBranch = line.moving && line.changedBranch && line.changedElement
      ? twelveStageFor(line.changedElement, line.changedBranch)
      : undefined;
    const notes = [
      byDay && TWELVE_STAGE_CORE.has(byDay) ? `日辰${byDay}：${twelveStageNote(byDay)}` : '',
      byChangedBranch && TWELVE_STAGE_CORE.has(byChangedBranch)
        ? `动化${byChangedBranch}：${twelveStageNote(byChangedBranch)}`
        : '',
    ].filter(Boolean) as string[];

    return {
      position: line.position,
      byDay,
      byChangedBranch,
      sourceTable: '易隐_长生定局' as const,
      interpretationLevel: '辅助状态' as const,
      notes,
    };
  });
  return { lineStages };
}
