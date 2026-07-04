# Liuyao Charting Workflow

## Purpose

This skill is a standalone migration of the deterministic Liuyao charting layer from OrbitAgent. It is meant to produce a structured chart without starting services, cloning OrbitAgent, calling an LLM, or touching user data.

## Input Modes

Use exactly one casting mode:

- `--yao 7,7,9,7,8,6`: six raw 爻值, bottom-to-top. `6=老阴`, `7=少阳`, `8=少阴`, `9=老阳`.
- `--bits 1,1,1,1,1,1`: six static yin/yang bits, bottom-to-top. `0=阴`, `1=阳`; no moving lines.
- `--coins 正反反,...`: six throws, comma-separated, each throw containing three `正/反` faces. Rule: `正=3`, `反=2`.
- `--random-coins`: generate six local random 3-coin throws.
- `--numbers 11,22,5`: 三数起卦, first number for upper trigram, second for lower trigram, third for moving line.
- `--time-cast --datetime ...`: Gregorian time-style casting using year/month/day/hour branch number; this is 起卦 only, not exact 干支 calendar conversion.
- `--character 财 --datetime ...`: one-character casting. Uses the bundled small stroke dictionary; falls back to Unicode code point.

## Time Pillars

For full decorations, pass:

```bash
--day-stem 甲 --day-branch 子 --month-branch 午
```

These enable:

- `dayStem`: 六神 and 旬空.
- `dayBranch`: 日冲/日合、日破、日辰十二长生.
- `monthBranch`: 月令旺衰、得月生/扶、被月克、月破.

If these are omitted, the script still outputs 本卦、变卦、宫位、世应、纳甲、六亲 and warnings.

## Output Contract

The script prints JSON. Important fields:

- `originalHexagram`, `changedHexagram`: structured 卦 metadata.
- `movingLines`: moving-line positions.
- `lines[]`: six lines bottom-to-top, including `rawValue`, `yinYang`, `stem`, `branch`, `element`, `sixRelative`, `sixGod`, `isShi`, `isYing`, `void`, `strength`, `twelveStage`, and changed-line fields.
- `relations.lineRelations`: deterministic branch relations currently supported by the migrated table.
- `transformations`: moving-line 化生/化克/回头生/回头克/化破 tags.
- `hiddenGods`: 伏神/飞神 entries.
- `yongshen`: rule-based candidates when `--question` or `--question-type` is supplied.
- `warnings`: missing optional inputs or intentionally unsupported exact-calendar behavior.

## Confirmation Boundary

Allowed without confirmation:

- Reading this skill.
- Running `liuyao_chart.py`.
- Reading JSON output.

Confirm first:

- Writing chart output to a file.
- Creating a report or interpretation artifact.
- Editing the bundled data or charting code.
- Installing packages or using external calendar/network sources.
