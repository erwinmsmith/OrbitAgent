# OpenClaw Profile

Use this profile for OpenClaw-style agents that can load a tool description and execute shell commands.

Tool command:

```bash
python3 scripts/liuyao_chart.py
```

Required behavior:

- Pass exactly one casting mode: `--yao`, `--bits`, `--coins`, `--random-coins`, `--numbers`, `--time-cast`, or `--character`.
- Pass `--day-stem`, `--day-branch`, and `--month-branch` when the user wants full 六神、旬空、旺衰 output.
- Parse the JSON result and cite fields from it directly.
- Clone only from `https://github.com/erwinmsmith/OrbitAgent.git` if source code inspection is explicitly needed.

