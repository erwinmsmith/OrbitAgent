/**
 * 5.12 Transformation Skill — for one moving line, decide the
 * relation between original and changed line (化生/化克/回头生/...).
 *
 * Pure logic over WUXING_SHENG/KE plus the line positions.
 */
import type { TransformationSkillInput, TransformationSkillOutput } from '../types/skill';
import { WUXING_KE, WUXING_SHENG } from '../constants/wuxing';
import { BRANCH_CLASH } from '../constants/branches';
import { xunkongForDayStem } from '../constants/xunkong';

export function transformationSkill(input: TransformationSkillInput): TransformationSkillOutput {
  const { originalLine, changedLine } = input;
  const relation: TransformationSkillOutput['relation'] =
    WUXING_SHENG[originalLine.element] === changedLine.element ? '化生' :
    WUXING_KE[originalLine.element]   === changedLine.element ? '化克' :
    WUXING_SHENG[changedLine.element] === originalLine.element ? '回头生' :
    WUXING_KE[changedLine.element]   === originalLine.element ? '回头克' :
    BRANCH_CLASH[originalLine.branch] === changedLine.branch   ? '化破' :
    '普通变化';

  return {
    position: input.changedLine.position,
    fromBranch: originalLine.branch,
    toBranch:   changedLine.branch,
    fromElement: originalLine.element,
    toElement:   changedLine.element,
    relation,
  };
}

// silence unused import warning (BRANCH_CLASH re-exported via utils)
void xunkongForDayStem;
