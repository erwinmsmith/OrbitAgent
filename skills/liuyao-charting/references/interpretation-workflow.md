# Interpretation Workflow

Read this file after a deterministic chart exists and the user asks for 解卦、断卦、分析、趋势判断, or a narrative report.

## Grounding Contract

- Treat `scripts/liuyao_chart.py` JSON as the only chart source of truth.
- Do not recalculate 本卦、变卦、动爻、纳甲、六亲、六神、世应、旬空、旺衰、十二长生、伏神、用神.
- If a field is missing, null, or warned as incomplete, say it is missing instead of inventing it.
- Separate "排盘事实" from "解释判断". The first is deterministic; the second is a cautious reading based on those facts.
- Avoid absolute claims such as 一定成、一定败、必发财、必有灾. Use 倾向、显示、需要观察、风险点.

## Minimum Inputs

Useful interpretation needs:

- The user's real question and context.
- Casting input or an already generated chart JSON.
- Day stem, day branch, and month branch when judging 六神、旬空、旺衰、日月生克.
- A timeframe or decision boundary when the user asks "会不会/能不能/何时".

Ask a short clarification before full interpretation when:

- The user question is gibberish or too short to identify intent.
- The chart is missing and no casting input is available.
- The user asks a relationship, medical, legal, financial, or high-risk question without enough real-world context.
- The user asks for exact Gregorian-to-干支 conversion but no verified pillars are available.

## Reading Order

1. Confirm question type and 用神.
   - Use `questionType` and `yongshen.candidates`.
   - For project/product questions, usually prioritize 子孙 for product/output, 父母 for documents/code/contracts, 官鬼 for blockers/risk, 妻财 for revenue.
   - If no clear 用神 exists, state that and rely more on 世应、动爻、卦象 trend.

2. State the chart facts.
   - 本卦/变卦/fullName, 动爻, 世爻/应爻, 旬空, warnings.
   - Mention only fields present in JSON.

3. Evaluate 用神 and 世应.
   - Locate 用神 candidates by position and 六亲.
   - Compare 用神 with 世爻/应爻 and relevant day/month relations.
   - If 用神 is hidden as 伏神, explain it as "not directly surfaced" and consider 飞神 relation.

4. Evaluate strength and timing labels.
   - Use `strength.labels`, `void`, day/month relations, 月破/日破 if present.
   - 十二长生 is auxiliary only; do not let it replace 生克、旺衰、空破, or 用神判断.
   - 空亡 is not automatic failure: judge whether the line is strong, moving, filled by day/month, or also weak/broken.

5. Evaluate moving lines and transformations.
   - Focus on `movingLines[]` and `transformations[]`.
   - Explain whether a moving line changes toward 生/克/比/泄/耗 or another useful tag present in JSON.
   - If a moving 用神 changes into another 六亲, use `changedSixRelative` from the line.

6. Evaluate relations and hidden gods.
   - Use `relations.lineRelations`, `relations.dayRelations`, and `hiddenGods`.
   - Keep this secondary unless the relation directly affects 用神、世爻、应爻, or 动爻.

7. Synthesize.
   - Combine supportive signs and risk signs.
   - Answer the user's question first, then explain why.
   - End with uncertainties, missing context, and practical next steps.

## Standard Lenses

Use these as optional analysis angles, especially for longer reports:

- 用神与旺衰: 用神候选的强弱、空破、日月生克.
- 世应与动变: 世爻/应爻 relation, moving lines, transformed branches/relatives.
- 时间与月令: month/day influence, xunkong, timing constraints.
- 飞神伏神: hidden or blocked matter, especially when 用神不现.
- 古断/类例: only if the runtime has a trusted knowledge source; do not invent citations.

## Output Modes

Quick answer:

- 3-5 sentences.
- Begin with the tendency.
- Include the strongest chart facts and one uncertainty.

Structured report:

- Use `prompts/report-template.md`.
- Keep the report grounded in JSON fields.
- Use citations only if a tool or knowledge source supplied real source strings.

Follow-up chat:

- Reuse the same chart facts.
- Answer the new question directly.
- Do not rerun or alter the chart unless the user asks for a new cast.

## Safety Boundaries

- Medical, legal, financial, and emergency topics require cautious framing and should point to qualified help for real decisions.
- Do not claim supernatural certainty or deterministic outcomes.
- Do not expose internal implementation terms unless the user is asking about development or debugging.
