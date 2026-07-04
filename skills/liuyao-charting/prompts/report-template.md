# Report Template

Use this template for structured 解卦. Omit sections that have no supporting chart facts, and keep the output proportional to the user's request.

## Full Report

```markdown
## 结论先行

用 2-4 句回答用户最关心的问题。说明整体倾向、主要支持点、主要风险点。

## 排盘摘要

- 本卦：{{originalHexagram.fullName}}，{{originalHexagram.palaceName}}，五行 {{originalHexagram.element}}
- 变卦：{{changedHexagram.fullName or "无变卦"}}
- 动爻：{{movingLines}}
- 世应：世爻 {{shiLine}}；应爻 {{yingLine}}
- 旬空/警告：{{xunkong_and_warnings}}

## 用神与世应

说明 questionType、主要用神、辅助用神。列出用神所在爻位、六亲、五行、是否空亡、旺衰标签，并说明它和世爻/应爻的关系。

## 旺衰、空破与日月

只使用 JSON 已给出的 strength labels、void、relations、time fields。空亡需要结合旺衰、动静、日月生克和化出，不直接判为无效。

## 动爻与变卦

分析每个动爻的六亲、六神、变出地支/五行/六亲、transformation relation，以及它对问题的实际含义。

## 飞神伏神与冲合

仅在 hiddenGods 或 relations 存在时输出。说明其对用神、世爻、应爻、动爻的影响。

## 综合判断

把有利条件和不利条件合并，回答"更偏向什么"以及"什么条件会改变判断"。

## 不确定性与补充信息

列出缺失背景、排盘 warnings、时间边界、需要用户补充的现实信息。

## 建议

给出 1-3 条非宿命、可执行的现实建议。
```

## Quick Answer

```markdown
从当前卦盘看，{{direct_tendency}}。
主要依据是：{{strongest_facts}}。
需要注意：{{risk_or_uncertainty}}。
现实建议：{{practical_next_step}}。
```

## Follow-Up Answer

```markdown
沿用刚才这卦，{{direct_answer_to_follow_up}}。
这里仍以 {{relevant_chart_fact}} 为关键；{{new_detail}}。
如果你要看新的问题或新的时间点，需要重新起卦。
```
