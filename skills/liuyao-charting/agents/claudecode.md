# Claude Code Profile

Add or reference these instructions from `CLAUDE.md` when using this skill in Claude Code.

Use `scripts/liuyao_chart.py` as the only deterministic charting engine. Do not recompute chart fields manually. For exact source comparison or regeneration, clone the public source:

```bash
git clone https://github.com/erwinmsmith/OrbitAgent.git
```

Inputs and output contract are documented in `references/workflow.md`.

For 解卦/断卦 tasks, generate the chart before interpretation, then read `references/interpretation-workflow.md` plus `prompts/system-prompt.md`, `prompts/report-template.md`, and `prompts/few-shots.md`. Do not let prompt examples override the current chart JSON.
