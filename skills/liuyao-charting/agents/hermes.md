# Hermes Profile

Use this profile for Hermes-style agents that support custom tool prompts or file-backed skills.

Primary action:

```bash
python3 scripts/liuyao_chart.py <args>
```

Interpretation boundary:

- `originalHexagram`, `changedHexagram`, `movingLines`, and `lines[]` are deterministic facts.
- `yongshen`, `hiddenGods`, `strength`, `relations`, and `transformations` are rule-based annotations.
- Narrative judgement must be labeled as interpretation and must not alter deterministic fields.
- For 解卦/断卦, read `references/interpretation-workflow.md` and the files under `prompts/` after generating the chart.

Public source clone, when needed:

```bash
git clone https://github.com/erwinmsmith/OrbitAgent.git
```
