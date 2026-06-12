
六爻纳甲 Agent 设计文档

1. 项目定位

本项目旨在设计一个 程序驱动、表驱动、Agent 分析驱动 的六爻纳甲系统。

系统不是让大模型自由起卦、装卦或断卦，而是将六爻流程拆分为两层：

程序层：负责所有确定性排盘、装卦、规则计算
Agent 层：负责读取程序输出，进行解释、分析、总结与追问

也就是说：

起卦、装卦、变卦、纳甲、六亲、六神、世应、用神候选、冲合刑害、旬空、旺衰等流程化内容
全部由程序完成。
Agent 只做分析，不做基础计算。

核心原则：

程序负责“算准”
Agent 负责“说清楚”

⸻

2. 系统边界

2.1 程序必须负责的内容

以下内容不能交给 LLM 自由生成，必须由硬编码表和规则函数完成：

1. 起卦输入归一化
2. 六爻值生成
3. 阴阳判断
4. 动爻判断
5. 变爻生成
6. 本卦识别
7. 变卦识别
8. 上卦/下卦识别
9. 六十四卦匹配
10. 八宫卦宫判断
11. 世应定位
12. 纳甲装配
13. 地支装配
14. 五行装配
15. 六亲计算
16. 六神排布
17. 旬空计算
18. 月建/日辰关系
19. 地支冲合刑害破判断
20. 动爻化出关系
21. 用神候选提取
22. 元神、忌神、仇神候选
23. 伏神、飞神提取
24. 旺衰状态标签

2.2 Agent 可以负责的内容

Agent 只基于程序输出做分析，主要负责：

1. 解释排盘结果
2. 总结本卦与变卦关系
3. 分析动爻含义
4. 分析世应关系
5. 分析用神状态
6. 分析六亲结构
7. 分析六神辅助含义
8. 整合程序给出的冲合、空破、旺衰标签
9. 给出多角度判断
10. 给出不确定性说明
11. 引导用户补充问题背景
12. 生成可读报告

Agent 不允许做：

1. 自行判断本卦
2. 自行判断变卦
3. 自行装纳甲
4. 自行判断六亲
5. 自行判断六神
6. 自行判断世应
7. 自行编造旬空
8. 自行编造旺衰
9. 自行修改程序返回的排盘结果

⸻

3. 总体架构

User Input
  |
  v
Input Normalizer
  |
  v
Casting Skill
  |
  v
Hexagram Skill
  |
  +--> 本卦
  +--> 变卦
  +--> 动爻
  |
  v
Decorating Skills
  |
  +--> 纳甲 Skill
  +--> 六亲 Skill
  +--> 六神 Skill
  +--> 世应 Skill
  |
  v
Advanced Rule Skills
  |
  +--> 旬空 Skill
  +--> 冲合 Skill
  +--> 旺衰 Skill
  +--> 用神 Skill
  +--> 伏神 Skill
  |
  v
Structured Chart Object
  |
  v
Analysis Agent
  |
  v
User-facing Report

⸻

4. Skill 设计总览

系统中的 skill 是确定性工具，不是自由 Agent。

每个 skill 都应该满足：

1. 输入结构化
2. 输出结构化
3. 可单元测试
4. 不依赖自然语言推理
5. 不允许自由解释
6. 可以被 Agent 调用

⸻

5. Skill 列表

5.1 Casting Skill：起卦 Skill

职责：

将用户输入转换为六个爻值。

支持输入：

1. 手动输入六个爻值
2. 三枚铜钱起卦
3. 数字起卦
4. 时间起卦
5. 汉字起卦

输出：

type CastResult = {
  rawValues: [6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9]
  linesBottomToTop: YaoLine[]
  movingPositions: number[]
}

规则：

6 = 老阴，动，变阳
7 = 少阳，静，不变
8 = 少阴，静，不变
9 = 老阳，动，变阴

⸻

5.2 Hexagram Skill：本卦/变卦 Skill

职责：

根据六个爻值识别本卦和变卦。

输入：

type HexagramSkillInput = {
  rawValues: [6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9, 6 | 7 | 8 | 9]
}

输出：

type HexagramSkillOutput = {
  originalLines: [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1]
  changedLines: [0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1]
  originalHexagram: HexagramMeta
  changedHexagram: HexagramMeta
  movingLines: number[]
}

注意：

0 = 阴
1 = 阳
数组永远从初爻到上爻

⸻

5.3 Palace Skill：卦宫与世应 Skill

职责：

根据本卦识别卦宫、卦宫五行、世爻、应爻。

输入：

type PalaceSkillInput = {
  originalHexagramName: string
}

输出：

type PalaceSkillOutput = {
  palace: TrigramName
  palaceElement: WuXing
  palaceType: "本宫" | "一世" | "二世" | "三世" | "四世" | "五世" | "游魂" | "归魂"
  shi: 1 | 2 | 3 | 4 | 5 | 6
  ying: 1 | 2 | 3 | 4 | 5 | 6
}

实现方式：

直接查六十四卦硬编码表，不让 Agent 推导。

⸻

5.4 NaJia Skill：纳甲 Skill

职责：

根据本卦上下卦，为六个爻装配天干、地支、五行。

输入：

type NaJiaSkillInput = {
  lowerTrigram: TrigramName
  upperTrigram: TrigramName
}

输出：

type NaJiaSkillOutput = {
  lines: [
    NaJiaLine,
    NaJiaLine,
    NaJiaLine,
    NaJiaLine,
    NaJiaLine,
    NaJiaLine
  ]
}

其中：

type NaJiaLine = {
  position: 1 | 2 | 3 | 4 | 5 | 6
  stem: HeavenlyStem
  branch: EarthlyBranch
  element: WuXing
}

实现方式：

下卦使用该八卦的 inner 纳甲
上卦使用该八卦的 outer 纳甲

⸻

5.5 Six Relative Skill：六亲 Skill

职责：

根据卦宫五行与每爻五行计算六亲。

输入：

type SixRelativeSkillInput = {
  palaceElement: WuXing
  lineElements: WuXing[]
}

输出：

type SixRelativeSkillOutput = {
  relatives: SixRelative[]
}

规则：

同我者：兄弟
生我者：父母
我生者：子孙
克我者：官鬼
我克者：妻财

注意：

六亲由程序根据五行生克计算。
Agent 不能自行判断某爻是什么六亲。

⸻

5.6 Six God Skill：六神 Skill

职责：

根据日干为六爻装配六神。

输入：

type SixGodSkillInput = {
  dayStem: HeavenlyStem
}

输出：

type SixGodSkillOutput = {
  gods: [SixGod, SixGod, SixGod, SixGod, SixGod, SixGod]
}

规则：

甲乙日：初爻起青龙
丙丁日：初爻起朱雀
戊日：初爻起勾陈
己日：初爻起螣蛇
庚辛日：初爻起白虎
壬癸日：初爻起玄武

六神顺序：

青龙 -> 朱雀 -> 勾陈 -> 螣蛇 -> 白虎 -> 玄武

⸻

5.7 Calendar Skill：干支历 Skill

职责：

根据公历时间计算干支日、月建、旬空等时间信息。

输入：

type CalendarSkillInput = {
  datetime: string
  timezone: string
}

输出：

type CalendarSkillOutput = {
  yearStem: HeavenlyStem
  yearBranch: EarthlyBranch
  monthStem: HeavenlyStem
  monthBranch: EarthlyBranch
  dayStem: HeavenlyStem
  dayBranch: EarthlyBranch
  hourStem?: HeavenlyStem
  hourBranch?: EarthlyBranch
  xunkong: [EarthlyBranch, EarthlyBranch]
  solarTerm?: string
}

注意：

月建应优先按照节气月计算，而不是简单农历月。

MVP 中可以暂时让用户手动传入日干，后续再接入 Calendar Skill。

⸻

5.8 Branch Relation Skill：地支关系 Skill

职责：

计算地支之间的冲、合、刑、害、破、三合等关系。

输入：

type BranchRelationSkillInput = {
  lines: ChartLine[]
  dayBranch: EarthlyBranch
  monthBranch: EarthlyBranch
}

输出：

type BranchRelationSkillOutput = {
  relations: BranchRelation[]
}

示例输出：

type BranchRelation = {
  source: string
  target: string
  type: "冲" | "合" | "刑" | "害" | "破" | "三合"
  description: string
}

⸻

5.9 Void Skill：旬空 Skill

职责：

根据日柱计算旬空，并标记每爻是否旬空。

输入：

type VoidSkillInput = {
  dayStem: HeavenlyStem
  dayBranch: EarthlyBranch
  lineBranches: EarthlyBranch[]
}

输出：

type VoidSkillOutput = {
  xunkong: [EarthlyBranch, EarthlyBranch]
  emptyLines: number[]
}

⸻

5.10 Strength Skill：旺衰 Skill

职责：

根据月建、日辰、地支关系判断每爻旺衰状态。

输入：

type StrengthSkillInput = {
  lines: ChartLine[]
  monthBranch: EarthlyBranch
  dayBranch: EarthlyBranch
}

输出：

type StrengthSkillOutput = {
  lineStrengths: LineStrength[]
}

示例：

type LineStrength = {
  position: 1 | 2 | 3 | 4 | 5 | 6
  labels: Array<"旺" | "相" | "休" | "囚" | "死" | "月破" | "日破" | "旬空" | "得日生" | "得月生">
  score?: number
}

注意：

旺衰判断可以先做标签化，不必一开始做最终吉凶判断。

⸻

5.11 Yongshen Skill：用神 Skill

职责：

根据问题类型和六亲结构，提出用神候选。

输入：

type YongshenSkillInput = {
  question: string
  questionType?: QuestionType
  chart: ChartResult
}

输出：

type YongshenSkillOutput = {
  candidates: YongshenCandidate[]
}

示例：

type YongshenCandidate = {
  relative: SixRelative
  positions: number[]
  reason: string
  confidence: "low" | "medium" | "high"
}

用神规则示例：

求财：妻财为用神
求事业/职位：官鬼为用神，父母为辅助
求考试/文书/合同：父母为用神
求感情，男问女：妻财为用神
求感情，女问男：官鬼为用神
求疾病：官鬼为病，子孙为药
求子女/宠物/下属：子孙为用神
求朋友/兄弟/竞争者：兄弟为用神

注意：

用神可以由程序给候选。
Agent 只能解释候选，不应完全自由选择。

⸻

5.12 Transformation Skill：动爻化出 Skill

职责：

分析动爻变出后的关系。

输入：

type TransformationSkillInput = {
  originalLine: ChartLine
  changedLine: ChartLine
}

输出：

type TransformationSkillOutput = {
  position: number
  fromBranch: EarthlyBranch
  toBranch: EarthlyBranch
  fromElement: WuXing
  toElement: WuXing
  relation: "化生" | "化克" | "回头生" | "回头克" | "化进" | "化退" | "化空" | "化破" | "普通变化"
}

⸻

5.13 FuShen Skill：伏神飞神 Skill

职责：

当某类六亲在本卦不显时，查找伏神与飞神。

输入：

type FuShenSkillInput = {
  originalHexagram: HexagramMeta
  palacePureHexagram: HexagramMeta
  visibleRelatives: SixRelative[]
}

输出：

type FuShenSkillOutput = {
  hiddenGods: FuShenItem[]
}

第一阶段可以不做。

⸻

6. 程序排盘主流程

完整程序流程如下：

Step 1. 接收用户输入
  - 问题
  - 起卦方式
  - 起卦时间
  - 六个爻值或起卦材料
Step 2. Input Normalizer
  - 校验输入
  - 统一格式
Step 3. Casting Skill
  - 生成六个爻值
  - 判断阴阳
  - 判断动静
Step 4. Hexagram Skill
  - 生成本卦 lines
  - 生成变卦 lines
  - 匹配本卦
  - 匹配变卦
  - 标记动爻
Step 5. Palace Skill
  - 查卦宫
  - 查卦宫五行
  - 查世爻
  - 查应爻
Step 6. NaJia Skill
  - 下卦装 inner 纳甲
  - 上卦装 outer 纳甲
  - 得到每爻天干、地支、五行
Step 7. Six Relative Skill
  - 根据卦宫五行和每爻五行计算六亲
Step 8. Calendar Skill
  - 根据起卦时间计算日干、日支、月建、旬空
Step 9. Six God Skill
  - 根据日干装六神
Step 10. Void Skill
  - 根据日柱旬空标记空亡爻
Step 11. Branch Relation Skill
  - 计算日辰/月建与各爻关系
  - 计算爻与爻之间冲合刑害破
Step 12. Transformation Skill
  - 对动爻计算化出关系
Step 13. Yongshen Skill
  - 根据问题类型提出用神候选
  - 标记用神、元神、忌神、仇神候选
Step 14. Strength Skill
  - 根据月建、日辰、空破等标签计算旺衰状态
Step 15. 输出 ChartResult
  - 结构化排盘
  - 所有标签
  - 所有候选
  - 所有程序判断依据

⸻

7. Agent 分析流程

Agent 的分析流程必须发生在程序排盘之后。

Agent 输入不是原始起卦材料，而是完整的 ChartResult。

ChartResult
  |
  v
Analysis Agent
  |
  +--> 读取排盘摘要
  +--> 读取本卦/变卦
  +--> 读取动爻
  +--> 读取世应
  +--> 读取用神候选
  +--> 读取旺衰标签
  +--> 读取冲合空破标签
  +--> 生成分析报告

⸻

8. Agent 详细分析步骤

Step A：问题识别

Agent 首先识别用户问题类型。

求财
求事业
求感情
求考试
求合同
求健康
求失物
求出行
求合作
求官司
求宠物
其他

Agent 可以辅助判断问题类型，但如果程序已经给出 questionType，则优先使用程序结果。

输出：

type QuestionUnderstanding = {
  questionType: QuestionType
  userFocus: string
  missingContext: string[]
}

⸻

Step B：排盘摘要

Agent 读取程序输出，整理摘要。

必须包括：

本卦
变卦
动爻
卦宫
世爻
应爻
用神候选
关键标签

示例：

本卦为雷水解，变卦为泽水困。
本卦属震宫，五行为木。
二爻发动，动而化出某爻。
世爻在三爻，应爻在上爻。
程序根据问题类型给出的用神候选为官鬼。

注意：

Agent 只能复述程序返回结果。
不能自己改卦名、改六亲、改六神。

⸻

Step C：本卦分析

Agent 分析本卦，但只做象义解释，不做排盘计算。

分析内容：

1. 本卦总体气象
2. 本卦和用户问题的关系
3. 卦宫五行背景
4. 本卦是否为六合/六冲/游魂/归魂等程序标签

Agent 依赖字段：

chart.originalHexagram
chart.tags.hexagramTags

⸻

Step D：变卦分析

Agent 分析变卦代表的发展趋势。

分析内容：

1. 变卦相对本卦的变化方向
2. 事情后续状态
3. 从本卦到变卦的结构变化
4. 动爻导致的关键转折

Agent 依赖字段：

chart.changedHexagram
chart.movingLines
chart.transformations

⸻

Step E：动爻分析

Agent 逐个分析动爻。

每个动爻需要读取：

位置
六亲
六神
地支
五行
是否世爻
是否应爻
是否用神
是否旬空
是否月破/日破
化出关系

Agent 输出示例：

二爻发动，该爻为妻财，代表财务、资源或关系中的现实利益。
程序标记该爻临朱雀，说明表达、沟通、文书因素较突出。
该爻发动后化出官鬼，表示事情可能从资源问题转向压力、规则或责任问题。

注意：

“二爻为妻财”“临朱雀”“化出官鬼”这些都必须来自程序结果。
Agent 只能解释含义。

⸻

Step F：世应分析

Agent 分析世爻和应爻关系。

分析内容：

1. 世爻代表用户自身
2. 应爻代表对方、环境、目标或外部条件
3. 世应六亲关系
4. 世应五行生克
5. 世应是否冲合
6. 世应是否空破
7. 世应是否发动

Agent 依赖字段：

chart.lines.find(line => line.isShi)
chart.lines.find(line => line.isYing)
chart.relations.shiYing

程序应该预先计算：

世应五行关系
世应地支关系
世应动静
世应空破

Agent 只解释这些标签。

⸻

Step G：用神分析

Agent 根据程序给出的用神候选进行分析。

Agent 不自由选择用神，只能：

1. 解释程序推荐用神
2. 比较多个候选
3. 说明为什么某个候选更重要
4. 提醒用户如果问题背景不同，用神可能需要调整

用神分析读取：

chart.yongshen.candidates

分析内容：

1. 用神是否出现
2. 用神在哪一爻
3. 用神是否发动
4. 用神是否空亡
5. 用神是否月破/日破
6. 用神是否得月日生扶
7. 用神是否被克
8. 用神与世爻关系
9. 用神与应爻关系
10. 用神化出关系

⸻

Step H：元神、忌神、仇神分析

程序先根据用神五行提取：

元神：生用神者
忌神：克用神者
仇神：克元神或用神所克者，按流派可配置

Agent 分析：

1. 元神是否有力
2. 忌神是否发动
3. 忌神是否被制
4. 仇神是否干扰
5. 用神系统是否形成生扶链条

Agent 依赖字段：

chart.yongshen.supportingGods
chart.yongshen.hostileGods

⸻

Step I：旺衰与空破分析

Agent 读取程序给出的旺衰标签。

程序输出示例：

line.strength = {
  labels: ["得月生", "旬空"],
  score: 0.45
}

Agent 分析：

该爻虽得月建生扶，但被旬空削弱，因此不能简单视为有力。

注意：

Agent 不自行判断旺衰。
Agent 只解释程序标签之间的关系。

⸻

Step J：冲合刑害分析

Agent 读取程序给出的地支关系。

程序输出示例：

{
  source: "世爻",
  target: "应爻",
  type: "冲",
  description: "世应相冲"
}

Agent 分析：

世应相冲，通常表示双方立场、节奏或目标存在冲突。
如果同时有动爻通关或合住，则冲突可能被缓和。

⸻

Step K：综合判断

Agent 综合前面各项，输出判断。

综合判断必须分层：

1. 当前状态
2. 主要矛盾
3. 有利因素
4. 不利因素
5. 变化趋势
6. 需要补充的信息
7. 谨慎结论

不要直接说：

一定成
一定不成
必有灾
必发财

应该说：

从程序排盘标签看，当前更偏向……
主要阻力在……
如果用户问题背景是……则判断会更偏向……

⸻

9. Agent Skill 调用策略

Agent 每次分析必须按固定顺序调用 skill。

9.1 完整排盘调用链

castSkill
  -> hexagramSkill
  -> palaceSkill
  -> najiaSkill
  -> sixRelativeSkill
  -> calendarSkill
  -> sixGodSkill
  -> voidSkill
  -> branchRelationSkill
  -> transformationSkill
  -> yongshenSkill
  -> strengthSkill
  -> chartAssembler
  -> analysisAgent

9.2 MVP 调用链

第一阶段可以只做：

castSkill
  -> hexagramSkill
  -> palaceSkill
  -> najiaSkill
  -> sixRelativeSkill
  -> sixGodSkill
  -> chartAssembler
  -> analysisAgent

也就是先不做：

旬空
月建
日辰
旺衰
伏神
飞神
用神自动判断
冲合刑害

9.3 Agent 不得跳过程序层

错误流程：

用户输入
  -> Agent 自己判断本卦
  -> Agent 自己装六亲
  -> Agent 自己解释

正确流程：

用户输入
  -> 程序排盘
  -> 结构化结果
  -> Agent 分析

⸻

10. ChartResult 结构设计

Agent 最终只读取 ChartResult。

export type ChartResult = {
  question?: string
  questionType?: QuestionType
  input: {
    type: string
    raw: unknown
  }
  time?: {
    datetime?: string
    timezone?: string
    yearStem?: HeavenlyStem
    yearBranch?: EarthlyBranch
    monthStem?: HeavenlyStem
    monthBranch?: EarthlyBranch
    dayStem?: HeavenlyStem
    dayBranch?: EarthlyBranch
    hourStem?: HeavenlyStem
    hourBranch?: EarthlyBranch
    xunkong?: [EarthlyBranch, EarthlyBranch]
  }
  originalHexagram: HexagramMeta
  changedHexagram: HexagramMeta
  movingLines: number[]
  lines: ChartLine[]
  relations?: {
    shiYing?: RelationTag[]
    lineRelations?: RelationTag[]
    dayRelations?: RelationTag[]
    monthRelations?: RelationTag[]
  }
  transformations?: TransformationResult[]
  yongshen?: {
    candidates: YongshenCandidate[]
    supportingGods?: GodCandidate[]
    hostileGods?: GodCandidate[]
  }
  summaryTags?: string[]
  warnings?: string[]
}

⸻

11. ChartLine 结构设计

export type ChartLine = {
  position: 1 | 2 | 3 | 4 | 5 | 6
  rawValue: 6 | 7 | 8 | 9
  yinYang: "阴" | "阳"
  moving: boolean
  changedYinYang: "阴" | "阳"
  stem: HeavenlyStem
  branch: EarthlyBranch
  element: WuXing
  sixRelative: SixRelative
  sixGod: SixGod
  isShi: boolean
  isYing: boolean
  isYongshen?: boolean
  isYuanshen?: boolean
  isJishen?: boolean
  isChoushen?: boolean
  void?: boolean
  monthBroken?: boolean
  dayBroken?: boolean
  strength?: {
    labels: string[]
    score?: number
  }
  tags?: string[]
}

⸻

12. Agent Prompt 约束

Agent 系统提示词必须明确：

你是六爻分析 Agent。
你不能自行排盘。
你不能自行修改本卦、变卦、六亲、六神、世应、纳甲、旬空、旺衰等程序结果。
所有结构化排盘信息必须来自 ChartResult。
你的任务是解释 ChartResult、组织分析、指出不确定性，并根据用户问题给出谨慎判断。
如果 ChartResult 缺少关键信息，你必须说明缺失项，而不是自行补全。

⸻

13. Agent 输出模板

Agent 输出建议固定为：

一、排盘摘要
二、本卦状态
三、变卦趋势
四、动爻分析
五、世应关系
六、用神与关键六亲
七、旺衰、空破与冲合
八、综合判断
九、不确定性与需要补充的信息

MVP 阶段可以简化为：

一、排盘摘要
二、本卦与变卦
三、动爻
四、世应
五、六亲与六神
六、初步分析

⸻

14. 输出示例

一、排盘摘要
本卦为雷水解，变卦为泽水困。
本卦属震宫，卦宫五行为木。
动爻为二爻和五爻。
世爻在三爻，应爻在上爻。
程序根据问题类型给出的用神候选为官鬼。
二、本卦状态
雷水解本身有“问题开始松动、压力有释放迹象”的象义。
但具体到六爻分析，不能只看卦名，还需要看用神、世应和动爻状态。
三、动爻分析
二爻发动，程序标记为妻财，临朱雀。
妻财通常对应资源、利益、现实条件；朱雀则常与表达、沟通、文书有关。
因此这个动爻提示：事情中可能存在资源条件或沟通表达方面的变化。
五爻发动，程序标记为官鬼，临白虎。
官鬼常对应压力、规则、责任、风险；白虎则常提示强压力、冲突或损耗。
因此该爻是需要重点关注的风险点。
四、世应关系
世爻代表用户自身，应爻代表对方或外部环境。
程序标记世应之间存在相冲，因此当前双方目标、节奏或条件可能并不完全一致。
如果后续动爻能形成通关或生扶，则冲突有缓和可能；否则阻力仍然明显。
五、综合判断
从当前结构看，这件事并不是完全没有机会，但过程不会很顺。
有利点在于本卦有解散阻滞之象；不利点在于官鬼发动且临白虎，说明压力、规则或外部阻碍较强。
因此更适合采取谨慎推进、先处理风险点的策略，而不是直接强推。

⸻

15. 实现目录建议

src/liuyao/
  constants/
    trigrams.ts
    yao.ts
    hexagrams.ts
    palaces.ts
    najia.ts
    stems.ts
    branches.ts
    wuxing.ts
    sixGods.ts
    sixRelatives.ts
    xunkong.ts
    branchRelations.ts
  skills/
    castSkill.ts
    hexagramSkill.ts
    palaceSkill.ts
    najiaSkill.ts
    sixRelativeSkill.ts
    sixGodSkill.ts
    calendarSkill.ts
    voidSkill.ts
    branchRelationSkill.ts
    transformationSkill.ts
    yongshenSkill.ts
    strengthSkill.ts
    fushenSkill.ts
    chartAssembler.ts
  agent/
    analysisAgent.ts
    prompts.ts
    reportTemplate.ts
    questionClassifier.ts
  types/
    basic.ts
    chart.ts
    skill.ts
    agent.ts
  tests/
    castSkill.test.ts
    hexagramSkill.test.ts
    palaceSkill.test.ts
    najiaSkill.test.ts
    sixRelativeSkill.test.ts
    sixGodSkill.test.ts
    chartAssembler.test.ts

⸻

16. MVP 实现优先级

第一优先级：

1. 八卦表
2. 六十四卦表
3. 八宫世应表
4. 纳甲表
5. 爻值转换
6. 本卦/变卦生成
7. 六亲计算
8. 六神排布
9. ChartResult 输出
10. Agent 分析模板

第二优先级：

1. 干支历
2. 旬空
3. 月建
4. 日辰
5. 冲合刑害
6. 用神候选
7. 旺衰标签

第三优先级：

1. 伏神飞神
2. 化进化退
3. 回头生克
4. 反吟伏吟
5. 分类断卦模板
6. 多轮追问

⸻

17. 关键设计结论

本系统最终应该是：

Deterministic Engine + Rule Skills + Analysis Agent

而不是：

LLM-based Divination Engine

即：

程序负责：
排盘、装卦、规则判断、标签生成。
Agent 负责：
解释、组织、综合、表达、不确定性说明。

这样可以保证：

1. 排盘结果稳定
2. 基础知识不被 LLM 编造
3. 每一步都可测试
4. 后续方便替换流派规则
5. Agent 的分析有依据
6. 用户可以追溯每个判断来自哪里

第一版最重要的不是“断得多玄”，而是 排盘结果绝对稳定、每个标签都有来源、Agent 不越权计算。

我建议你后面实现时把 skills/ 当成真正的核心。Agent 只是最后一层“分析器”，不要让它碰 hexagramSkill、najiaSkill 这种确定性逻辑的内部规则。