# Codex Profile

Use `SKILL.md` as the primary trigger and workflow document.

When a user asks for 六爻排盘、起卦、装卦、纳甲、六亲、六神、旬空、旺衰、伏神、用神, run:

```bash
python3 scripts/liuyao_chart.py <casting-input> [time-pillars]
```

Read `references/workflow.md` for input modes and output fields. Read `references/agent-support.md` when the task involves sharing this skill with other agent runtimes.

For 解卦/断卦, generate the chart first, then read `references/interpretation-workflow.md` and the needed files under `prompts/`. Treat the script JSON as the source of truth even when a few-shot seems similar.
