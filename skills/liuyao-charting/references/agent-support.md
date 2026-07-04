# Multi-Agent Support

This skill is intentionally runtime-neutral. The reliable interface for every agent is the same local command:

```bash
python3 scripts/liuyao_chart.py --yao 7,7,9,7,8,6 --day-stem 甲 --day-branch 子 --month-branch 午
```

Agent profiles live in `agents/`:

- `codex.md`: Codex skill usage.
- `claudecode.md`: Claude Code repository-instruction usage.
- `openclaw.md`: OpenClaw-style custom tool/profile usage.
- `hermes.md`: Hermes-style custom tool/profile usage.
- `generic.md`: Any agent that can run shell commands and read files.

## Required Agent Behavior

All agents should:

- Prefer the bundled script over mental recomputation.
- Treat JSON output as the source of truth.
- For 解卦/断卦, read `references/interpretation-workflow.md` and the prompt files under `prompts/` after generating the chart.
- Avoid cloning OrbitAgent unless the user explicitly needs source comparison or updates.
- If cloning is needed, clone the public source repository:

```bash
git clone https://github.com/erwinmsmith/OrbitAgent.git
```

- Clearly separate deterministic chart facts from interpretation.
- Do not let few-shot examples override the current chart JSON.
- Ask for `dayStem`, `dayBranch`, and `monthBranch` when the user expects 六神、旬空、旺衰、日月生克.
- Confirm before writing result files, creating reports, installing packages, or changing remote state.
