---
name: liuyao-charting
description: Deterministic Liuyao charting plus optional interpretation workflow prompts and few-shots. Use when the user asks about 六爻, 排盘, 起卦, 装卦, 纳甲, 六亲, 六神, 世应, 旬空, 旺衰, 十二长生, 伏神, 用神, 三数起卦, 时间起卦, 字占, 解卦, 断卦, or wants a structured hexagram chart and grounded narrative reading without cloning OrbitAgent.
---

# Liuyao Charting

## Core Rule

Use the bundled standalone script for deterministic charting. Do not require or clone `OrbitAgent`; the needed 64-gua data and charting rules are already bundled under this skill.

If the user asks for 解卦/断卦/分析, generate the chart first, then read `references/interpretation-workflow.md` and the relevant files under `prompts/`. The prompts guide narrative interpretation only; they must not override or recompute the script's JSON facts.

The skill covers:

- 起卦 inputs: explicit `yaoValues`, static `bits`, 3-coin throws, random coins, three-number casting, Gregorian time-style casting, and one-character casting.
- 排盘 decorations: 本卦/变卦, 动爻, 宫位, 世应, 纳甲, 六亲, 六神, 旬空, 日/月关系, 旺衰 tags, 十二长生, 伏神/飞神, transformation tags, and basic 用神 candidates.
- Structured output for later reading or reporting.
- Optional interpretation workflow, system prompt, report template, and few-shot patterns for grounded narrative readings.
- Agent profiles for Codex, Claude Code, OpenClaw, Hermes, and generic tool-using agents under `agents/`.

It does not include LLM provider calls, RAG retrieval, user/session persistence, API calls, or exact Gregorian-to-干支 calendar conversion. The bundled interpretation materials are prompt resources for whichever agent/runtime is using the skill.

## Workflow

1. Confirm whether the task is charting-only or charting plus interpretation.
2. Collect or infer casting input. Prefer explicit six 爻值 (`6/7/8/9`) when the user already has a cast. Use `bits` only for static charts.
3. Ask for `dayStem`, `dayBranch`, and `monthBranch` when the user wants 六神、旬空、旺衰、日月生克. If they are absent, run the script anyway and keep the warnings.
4. Run `scripts/liuyao_chart.py`; do not recompute chart fields mentally when the script can produce them.
5. Read the JSON result. Treat `lines[]`, `originalHexagram`, `changedHexagram`, `movingLines`, `hiddenGods`, `transformations`, and `yongshen` as the source of truth.
6. For narrative interpretation, load `references/interpretation-workflow.md`, then use `prompts/system-prompt.md`, `prompts/report-template.md`, and `prompts/few-shots.md` as needed.
7. Before writing files, reports, or saved result artifacts, confirm with the user. Reading existing outputs and running this local script is allowed without confirmation.

## Script

Use:

```bash
python3 skills/liuyao-charting/scripts/liuyao_chart.py --yao 7,7,9,7,8,6 --day-stem 甲 --day-branch 子 --month-branch 午 --question "这个项目上线顺不顺利"
```

Other common modes:

```bash
python3 skills/liuyao-charting/scripts/liuyao_chart.py --bits 1,1,1,1,1,1 --day-stem 甲 --day-branch 子
python3 skills/liuyao-charting/scripts/liuyao_chart.py --coins 正反反,正正反,反反反,正正正,正反反,正反反
python3 skills/liuyao-charting/scripts/liuyao_chart.py --numbers 11,22,5 --day-stem 丙 --day-branch 午 --month-branch 巳
python3 skills/liuyao-charting/scripts/liuyao_chart.py --time-cast --datetime 2026-07-04T10:00:00+08:00
python3 skills/liuyao-charting/scripts/liuyao_chart.py --character 财 --datetime 2026-07-04T10:00:00+08:00
```

For detailed input/output rules, read `references/workflow.md`.
For 解卦/断卦 workflow, read `references/interpretation-workflow.md`.
For reusable prompt text and examples, read `prompts/system-prompt.md`, `prompts/report-template.md`, and `prompts/few-shots.md`.
For non-Codex agent integration, read `references/agent-support.md` and the matching profile under `agents/`.

## Boundaries

- Do not modify `scripts/data/64gua.json` unless the task is explicitly to update the canonical 64-gua dataset.
- Do not mix this deterministic script with OrbitAgent runtime state, MongoDB, Redis, LLM provider config, or app backend config.
- Do not let a prompt example, remembered rule, or user claim override the JSON returned by `scripts/liuyao_chart.py`.
- If exact 干支 from a Gregorian datetime is required, obtain or verify the pillars from an authoritative calendar source, then pass them as `--day-stem`, `--day-branch`, and `--month-branch`.
