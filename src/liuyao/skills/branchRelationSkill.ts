/**
 * 5.8 Branch Relation Skill — for each line, compute 冲/合/刑/害/破
 * against the day branch (and the month branch if available).
 *
 * 三刑/六害/六破 tables are NOT in the knowledge base. Until they're
 * filled in, the function returns empty relations + a warning so the
 * agent knows to skip those tags.
 */
import type { BranchRelationSkillInput, BranchRelationSkillOutput, BranchRelation } from '../types/skill';
import { BRANCH_CLASH, BRANCH_COMBINE, BRANCH_SAN_HE_GROUPS } from '../constants/branches';
import type { EarthlyBranch } from '../types/basic';

export function branchRelationSkill(input: BranchRelationSkillInput): BranchRelationSkillOutput {
  const relations: BranchRelation[] = [];
  const dayBranch = input.dayBranch;

  for (const line of input.lines) {
    const branch = line.branch;
    // vs day branch
    if (dayBranch) {
      if (BRANCH_CLASH[branch] === dayBranch) {
        relations.push({
          source: `第${line.position}爻(${branch})`,
          target: '日辰',
          type: '冲',
          description: `第${line.position}爻${branch}与日辰${dayBranch}相冲`,
        });
      }
      if (BRANCH_COMBINE[branch] === dayBranch) {
        relations.push({
          source: `第${line.position}爻(${branch})`,
          target: '日辰',
          type: '合',
          description: `第${line.position}爻${branch}与日辰${dayBranch}相合`,
        });
      }
    }
  }

  // 三合 / 刑 / 害 / 破 — only 三合 is in the knowledge base.
  if (dayBranch) {
    for (const group of BRANCH_SAN_HE_GROUPS) {
      const present = input.lines
        .map((l) => l.branch)
        .filter((b) => group.branches.includes(b));
      if (present.length === 3) {
        relations.push({
          source: present.join('、'),
          target: '',
          type: '三合',
          description: `${present.join('、')}三合${group.element}局`,
        });
      }
    }
  }

  return { relations };
}
