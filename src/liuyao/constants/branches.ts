/**
 * Twelve Earthly Branches and their five-element classifications,
 * plus 生/克/冲/合/刑/害/破 lookup tables needed by the engine.
 *
 * Source: docs/base_knowledge/装卦方法.md 装五行段 (basic elements),
 * 六爻基础.md 第六/七/八/九节 (chong/he/san-he).
 * 三合/六合/六冲/半三合 are all in the knowledge base.
 *
 * 三刑 / 六害 / 六破 are listed as 缺失 — see KNOWLEDGE_NEEDED.md §12.
 */
import type { EarthlyBranch, WuXing } from '../types/basic';

/** All twelve branches in order, used for indexing and iteration. */
export const BRANCHES: readonly EarthlyBranch[] = [
  '子', '丑', '寅', '卯', '辰', '巳',
  '午', '未', '申', '酉', '戌', '亥',
] as const;

/** Branch → five-element mapping. ✅ 知识库齐全. */
export const BRANCH_ELEMENT: Record<EarthlyBranch, WuXing> = {
  '子': '水', '亥': '水',
  '寅': '木', '卯': '木',
  '巳': '火', '午': '火',
  '申': '金', '酉': '金',
  '辰': '土', '戌': '土', '丑': '土', '未': '土',
};

/** Six clashes (六冲) — opposite branches on the circle. ✅ 六爻基础.md §6. */
export const BRANCH_CLASH: Record<EarthlyBranch, EarthlyBranch> = {
  '子': '午', '午': '子',
  '丑': '未', '未': '丑',
  '寅': '申', '申': '寅',
  '卯': '酉', '酉': '卯',
  '辰': '戌', '戌': '辰',
  '巳': '亥', '亥': '巳',
};

/** Six combinations (六合). ✅ 六爻基础.md §9. */
export const BRANCH_COMBINE: Record<EarthlyBranch, EarthlyBranch> = {
  '子': '丑', '丑': '子',
  '寅': '亥', '亥': '寅',
  '卯': '戌', '戌': '卯',
  '辰': '酉', '酉': '辰',
  '巳': '申', '申': '巳',
  '午': '未', '未': '午',
};

/**
 * Three Harmonies (三合局). Each group of three branches, when present
 * together, forms a complete 五行 element. Half-harmonies (半三合)
 * are pairs within a group. ✅ 六爻基础.md §7, §8.
 */
export const BRANCH_SAN_HE_GROUPS: ReadonlyArray<{
  branches: [EarthlyBranch, EarthlyBranch, EarthlyBranch];
  element: WuXing;
}> = [
  { branches: ['寅', '午', '戌'], element: '火' },
  { branches: ['亥', '卯', '未'], element: '木' },
  { branches: ['申', '子', '辰'], element: '水' },
  { branches: ['巳', '酉', '丑'], element: '金' },
];

/** 三刑 / 六害 / 六破 — knowledge base doesn't have the full table. */
export const BRANCH_PUNISHMENT: Record<EarthlyBranch, EarthlyBranch | null> = {
  // TODO §12 — see KNOWLEDGE_NEEDED.md
  '子': null, '丑': null, '寅': null, '卯': null,
  '辰': null, '巳': null, '午': null, '未': null,
  '申': null, '酉': null, '戌': null, '亥': null,
};
export const BRANCH_HARM: Record<EarthlyBranch, EarthlyBranch | null> = {
  // TODO §12 — see KNOWLEDGE_NEEDED.md
  '子': null, '丑': null, '寅': null, '卯': null,
  '辰': null, '巳': null, '午': null, '未': null,
  '申': null, '酉': null, '戌': null, '亥': null,
};
export const BRANCH_BREAK: Record<EarthlyBranch, EarthlyBranch | null> = {
  // TODO §12 — see KNOWLEDGE_NEEDED.md
  '子': null, '丑': null, '寅': null, '卯': null,
  '辰': null, '巳': null, '午': null, '未': null,
  '申': null, '酉': null, '戌': null, '亥': null,
};
