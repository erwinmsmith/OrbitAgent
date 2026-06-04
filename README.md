# OrbitAgent

**Liuyeo Najia (Six-Yang I-Ching) hexagram casting + LLM interpretation**,
shipped as a multi-user AI backend.

The engine layer does deterministic chart assembly (本卦/变卦 —
original/changed hexagrams, 纳甲 — stem-branch assignment, 六亲 —
six relatives, 六神 — six gods, 世应 — world/response, 旬空 —
xunkong/void); the LLM layer turns the assembled chart into a
readable analysis report and converses with the user. Every rule
table (the 64 hexagrams, the 8-palace 纳甲 assignment, 六亲/六神
mapping, 旬空, day stem-branch) is hard-coded — the LLM doesn't
"compute," it only "explains."

```
                ┌─────────────────────────────────────┐
                │  Deterministic chart engine         │
                │  ────────────────────────────────  │
   6 bits ──►   │  cast → hexagram → palace → 纳甲   │  ──►  ChartResult
   or 6 yao     │  → sixRel → sixGod → void …        │      (stored in Mongo)
                │                                     │
                └─────────────────────────────────────┘
                                │
                                ▼
                ┌─────────────────────────────────────┐
                │  LLM analyst (per-user, scoped)     │
                │  ────────────────────────────────  │
                │  • reads ChartResult fields only   │
                │  • cites RAG chunks (Mongo + search)│
                │  • never recomputes any chart field│
                │  • produces 6/9-section report      │
                └─────────────────────────────────────┘
```

Core rule (from `design.md`): **the engine computes, the agent
explains**. The LLM is forbidden from recomputing any chart field;
if a field is missing it must say so.

---

## The Liuyeo subsystem — what's actually in the box

The chart assembly engine ([src/liuyao/](src/liuyao/)) ships with the
full first-step deterministic pipeline:

- **64-hexagram table** — `docs/base_knowledge/64卦数据.json` (卦辞,
  爻辞, 世应, 符号, 八宫归属) is loaded at module init and re-keyed
  into `HEXAGRAMS_BY_BITS` / `HEXAGRAMS_BY_NAME` / `HEXAGRAMS_BY_ID`.
  Every hexagram's palace, palaceType (本宫/一世/.../归魂), and element
  are derived from the (upper, lower) trigram pair.
- **13 skills** orchestrated by `chartAssembler.ts` in fixed order:
  `cast → hexagram → palace → najia → sixRelative → sixGod → void →
   branchRelation → transformation → yongshen → strength → fushen`
  (some are P2 stubs and gracefully report `warnings[]` instead of
  throwing).
- **纳甲** — all 8 trigrams × inner/outer × 3 lines (96 cells) from
  the standard 装纳甲歌诀.
- **六亲** — derived from `palaceElement` vs `lineElement` via
  the 五行生克 tables.
- **六神** — derived from `dayStem` (甲乙起青龙, 丙丁起朱雀, ...).
- **旬空** — derived from `dayStem` (5 day-stem groups).
- **RAG knowledge base** — `docs/base_knowledge/*.md` ships with
  the liuyao corpus (装卦方法, 六爻卦理, 易经详解, 实例应用,
  装卦补充 + 64 卦数据.json). The RAG store is Mongo-backed
  (`knowledge_documents` + `knowledge_chunks` collections) with
  per-user scoping: each user sees the system corpus + their own
  uploads, never another user's private uploads.

### Two-step flow (user + agent)

Every conversation is a divination conversation by default. The flow
is intentionally split so the LLM never recomputes the chart:

```
$ orbit divination chart 1 1 1 1 1 1 \
    --day-stem 甲 --day-branch 子 --session sess_demo
✓ Chart assembled and stored.
  orig: 乾   changed: 乾   palace: 乾宫 · 本宫 · 金
  shi/ying: 6/3   moving: none

$ orbit chat --session sess_demo "Will this investment pay off?"
Full 6-section report + RAG citations
```

The chart is persisted in `ChartStore` (Mongo, 24h TTL,
per-user scoped) under the session id. The agent reads it back via
the `divination` tool (single action: `analyze`), which calls
`runAnalysisAgent` → `buildReport` → RAG-augmented 6/9-section
report. The agent never sees raw bits.

### How a chart is computed

```bash
# static yin/yang (no moving lines)
orbit divination chart 1 1 1 1 1 1 --day-stem 甲 --day-branch 子

# 6/7/8/9 yao values (supports moving lines 6/9)
orbit divination chart --yao 7 7 7 7 9 7 --day-stem 甲 --day-branch 子
```

The CLI echoes back a one-line proof of the deterministic output
(本卦, 变卦, 卦宫 + 世/应, 6 lines × 纳甲/六亲/六神) so you can see
the engine produced what you expected before sending it to the LLM.

The bits/yao encoding is documented in the CLI's `--help` and in
`docs/base_knowledge/装卦方法.md`.

---

## Framework capabilities — what's behind the engine

Beneath the liuyao subsystem, OrbitAgent is a single Express service
with the standard pieces you'd expect for a production LLM backend.
You don't need any of this to use the liuyao product; it's there when
you want to extend.

### Multi-LLM support

10+ providers, 25+ models wired through one adapter interface
([src/core/llm/](src/core/llm/)). Native adapters (`anthropic`,
`openai`, `google`, `ollama`, `deepseek`) register when an API key is
present; OpenAI-compatible adapters (`kimi`, `siliconflow`, `groq`,
`together`, `perplexity`) share a single base class and register
automatically when their `<PROVIDER>_API_KEY` env var is set. Model
IDs are globally unique so the routing table is a single linear scan.

Default liuyao agent uses `deepseek-v4-flash` — the system prompt +
skill/tool list is ~1280 tokens and 100% hits the prompt cache, so
cache-friendly pricing makes the per-cast analysis essentially free.

### Multi-user isolation

Every store that holds user-owned business data scopes by `userId`
and rejects cross-user access:
- `ChartStore` ([src/core/memory/ChartStore.ts](src/core/memory/ChartStore.ts)) —
  one chart per `(userId, sessionId, chartKey)`, Mongo-backed with
  a TTL index, throws on cross-user read attempts.
- `PermanentMemory` — `Conversation` + `Message` collections scoped
  by userId; permanent storage is opt-in via
  `POST /api/v1/memory/permanent`.
- RAG — `knowledge_documents` + `knowledge_chunks` collections with
  `scope=system` (admin-managed) or `scope=user` (per-user uploads);
  searches union system chunks with the caller's own user-scope
  chunks only. See `tests/integration/multi-user-isolation.test.ts`
  (13 cases covering the cross-user access matrix).

### Agents, skills, tools, workflows

- **Agents** ([configs/agents.yaml](configs/agents.yaml)) — declarative
  YAML registry; ships with `default` (= liuyao), `generic`, and
  `coding` agents. Add a new agent: append to `agents.yaml`, drop a
  prompt at `prompts/system/<id>.yaml`, restart.
- **Skills** — preprocessing hooks in the chat pipeline; built-ins
  live in `src/core/skills/builtins/`. CLI exposes
  `orbit skill install <url|text>` and `orbit skill uninstall <id>`
  (admin only).
- **Tools** — `divination` (liuyao), `filesystem`, `search`, plus
  MCP servers declared in `config.yaml`. Per-agent tool filtering
  means the liuyao agent only sees `divination`; the `coding` agent
  sees `filesystem` and `search`.
- **Workflows** — YAML definitions in `configs/workflows/`, hot
  reloaded every 60s.

### Auth

Dual scheme: `X-API-Key` (hashed, permission-scoped) and JWT
(`Authorization: Bearer …`). Both middlewares are non-blocking by
default and chain together; admin routes add `adminOnly`. The `orbit
login --dev` path mints a 30-day JWT for the seeded dev user so you
can exercise the API without a full auth flow.

In dev (`NODE_ENV !== 'production'`) two users are auto-seeded:
- Admin: `admin@orbit.local` / `orbit_admin_2026`
- Test: `dev@test.local` / `devpassword123`

---

## Quick start

### Prerequisites

- Node.js 18+
- MongoDB (default `mongodb://localhost:27017/orbit_agent`)
- Redis (default `redis://localhost:6379`)

```bash
# macOS
brew services start mongodb-community
brew services start redis
```

### Install + run

```bash
npm install
cp .env.example .env          # fill in at least one LLM API key
npm run dev                   # ts-node + dotenv hot-load
```

Server runs at `http://localhost:3000`. Health: `GET /api/v1/health`.

### First liuyao session in 3 commands

```bash
# 1. Get a dev JWT
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/dev/token | jq -r .data.accessToken)

# 2. Cast a chart
curl -X POST http://localhost:3000/api/v1/divination/chart \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"bits":[1,1,1,1,1,1], "sessionId":"sess_demo",
       "dayStem":"甲", "dayBranch":"子",
       "question":"Will this investment pay off?"}'

# 3. Ask the agent to interpret
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sessionId":"sess_demo", "message":"Will this investment pay off?"}'
```

### CLI

```bash
# install the binary
npm run build && npm link

# login (dev)
orbit login --dev

# cast + chat
orbit divination chart 1 1 1 1 1 1 --day-stem 甲 --day-branch 子 \
  --question "Will this investment pay off?" --session sess_demo
orbit chat --session sess_demo "Analyze it for me"
```

The `orbit` binary is a thin client over the same REST API; it
doesn't re-implement any business logic. State lives in `~/.orbit/`
(overridable via `ORBIT_HOME`).

### RAG: ingest your own liuyao knowledge

```bash
# upload a markdown file (becomes user-scope, private to you)
orbit divination rag upload my-notes.md
orbit divination rag list

# admin can add to the system knowledge base
orbit divination rag upload my-system-doc.md --system
```

---

## Configuration

[config.yaml](config.yaml) is the source of truth for shape; use
[.env](.env) only for secrets and host/port overrides. `config.yaml`
substitutes `${VAR}` and `${VAR:default}` placeholders against
`process.env` and validates the merged tree with zod.

Provider model lists declared in `config.yaml` drive the
`/api/v1/models` API output.

Per-model token pricing (USD per million tokens, including
`cacheHitPricePerM` for prompt-cache hits) lives in
[src/models/TokenUsage.ts](src/models/TokenUsage.ts) — add new
model pricing there, not in `config.yaml`.

---

## API surface (the bits you actually call)

All routes mounted under `app.apiPrefix` (default `/api/v1`).
Authenticated routes accept either `Authorization: Bearer <jwt>` or
`X-API-Key: …`. Response envelope: `{ success, data?, error?: { code, message, details? } }`.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/divination/chart` | 6 bits or 6 yao values + dayStem/dayBranch → fully-decorated chart, persisted in ChartStore under the session. |
| `POST` | `/divination/analyze` | Reads a stored chart by sessionId (or accepts an inline chart) → AnalysisReport. |
| `GET` | `/divination/chart/keys/:sessionId` | List chart keys stored for the caller's session. |
| `POST` | `/divination/rag/upload` | Ingest a markdown doc (user-scope; admin can pass `scope=system`). |
| `GET` | `/divination/rag/list` | List docs the caller can see. |
| `POST` | `/divination/rag/search` | Top-k chunks (scoped). |
| `DELETE` | `/divination/rag/:source` | Delete a doc (bare filename accepted, server-resolves). |
| `POST` | `/chat` | Main chat. `agentId` defaults to `default` (= liuyao). |
| `POST` | `/chat/stream` | SSE streaming. |
| `POST` | `/auth/login` / `/auth/register` | JWT auth. |
| `GET` / `POST` | `/users/*` | Profile, check-in streaks, ritual task history, public feed. |
| `GET` | `/models` | List available models. |
| `GET` | `/models/health` | LLM provider health table. |
| `GET` | `/usage/stats` | Token usage summary + byModel + daily. |
| `GET` | `/health` | `{ status: "healthy", uptime }`. |
| `POST` | `/dev/token` | (dev only) Get a JWT without login. |

Error code namespaces: `1000=auth`, `2000=validation`, `3000=resource`,
`4000=LLM`, `5000=memory`, `6000=skills`, `7000=tools`, `8000=workflow`,
`9000=system`. See [API_DOC.md](API_DOC.md) for the full list.

---

## Project structure

```
src/
  app.ts                       # Application class — wires middleware,
                               # routes, services, runs startup health checks
  liuyao/                      # liuyao subsystem (default product)
    skills/                    # 13 deterministic skills
      chartAssembler.ts        #   orchestrates the 13 in fixed order
      castSkill.ts             #   6 bits/yaoValues → 6 爻值
      hexagramSkill.ts         #   bit pattern → 64-hexagram table lookup
      palaceSkill.ts           #   palace + 世/应
      najiaSkill.ts            #   纳甲 (stem + branch + element)
      sixRelativeSkill.ts      #   六亲 (五行生克)
      sixGodSkill.ts           #   六神 (day stem → starting god)
      voidSkill.ts             #   旬空 + mark empty lines
      branchRelationSkill.ts   #   冲/合/刑/害 (P2 stub)
      transformationSkill.ts   #   动爻化出 (P2 stub)
      yongshenSkill.ts         #   用神候选 (P2 stub)
      strengthSkill.ts         #   旺衰 labels (P2 stub)
      fushenSkill.ts           #   伏神 (P2 stub)
    agent/
      analysisAgent.ts         #   runAnalysisAgent — 3-stage pipeline
      chartBrief.ts            #   buildChartBrief — structured material
      reportTemplate.ts        #   6/9-section report builder
      questionClassifier.ts    #   question type → 用神 hint
    rag/
      index.ts                 #   Mongo-backed RAG with per-user scoping
    constants/                 # chart tables: 64-hexagrams, 纳甲, 五行, ...
    types/                     # chart TypeScript types (basic, chart, skill, agent)
  core/
    llm/                       # Multi-provider LLM adapters
    memory/                    # TemporaryMemory (Redis) + ChartStore (Mongo)
    agents/                    # AgentLoader (configs/agents.yaml)
    skills/                    # Generic skill pipeline (chat preprocessing)
    tools/                     # divination, filesystem, search, MCP
    workflow/                  # YAML workflow engine
    prompts/                   # System prompt loader
  users/                       # user subsystem (ritual tasks, profile, feed)
  routes/                      # Express routes (chat, auth, divination, ...)
  models/                      # Mongoose models
  services/                    # database, DevAuth, TokenService, SkillInstaller
  middleware/                  # auth, errorHandler
  cli/                         # `orbit` binary (thin client over REST)

docs/
  base_knowledge/              # liuyao knowledge base (system-scope RAG corpus)
    64卦数据.json              #   the 64-hexagram table (canonical source)
    装卦方法.md                #   装卦 + 装六亲 + 装六神 rules
    六爻卦理.md                #   六爻卦理 reference
    六爻基础.md                #   intro
    六爻用神.md                #   用神 rules
    实例应用.md                #   worked examples
    排盘补充.md                #   排盘 supplement (干支, 五虎五鼠遁, 旬空, 64卦详表)
    易经详解（上/下）.md       #   易经详解
    精华荟萃（上/下篇）.md     #   精华
    起卦方法.md                #   起卦

design.md                      # system design doc (排盘 flow + skill list)
CLAUDE.md                      # project notes for AI assistants
```

---

## Development

```bash
npm run dev          # ts-node + dotenv hot-load
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # jest
npm run test:unit    # unit only (76/76 pass — covers 排盘 first step)
npm run test:integration  # integration only (28/28 pass — needs live Mongo + Redis)
```

Path aliases (`@core/*`, `@config/*`, `@routes/*`, …) are defined in
both [tsconfig.json](tsconfig.json) and [jest.config.js](jest.config.js) —
update both when adding a new alias.

---

## Test scenario — the big-tech offer

A reproducible end-to-end scenario that exercises the full multi-stage
analysis pipeline. Use it to sanity-check that everything still works
after a refactor, or as a guided walkthrough of the system.

> **Story**: A backend engineer with two years of experience has just
> received an offer for a senior role at a large tech company. The
> on-site is scheduled for next Tuesday. They've been going back and
> forth on whether to accept, so they sit down with the coins.
>
> **Question**: *"Should I accept the senior engineer offer at the
> big tech company?"*
>
> **Cast time**: Right now (Asia/Shanghai). Pass `--datetime` to
> override.
>
> **Expected analytic angles**:
> - 官鬼 (official-ghost) is the primary 用神 (target spirit) — it
>   represents the position / offer itself.
> - 世爻 (world line) tells the querent's own state; this scenario
>   has the world on line 4, sitting in 旬空 (xunkong / void).
> - 应爻 (response line) is the employer / team.
> - The 4th line moves (老阳 → flips to 申 metal 父母), so the chart
>   has a real transformation to read.

### 1. Cast the chart

```bash
# 6 coins = yao values 7 8 7 9 7 8 (one 老阳 at position 4 → moving).
# Don't pass --day-stem / --day-branch — let the engine derive them
# from --datetime via the lunar-typescript calendar skill.
orbit divination chart --yao 7 8 7 9 7 8 \
  --datetime "$(TZ='Asia/Shanghai' date '+%Y-%m-%dT%H:%M:%S+08:00')" \
  --timezone 'Asia/Shanghai' \
  --question "Should I accept the senior engineer offer at the big tech company?" \
  --session sess_scenario_en
```

Engine output:

```
time:   丙午年 / 癸巳月 / 己酉日 / 癸酉时
旬空:  寅、卯    节气: 小满
palace:  坎宫 · 四世 · 水
shi/ying:  4/1
moving:  4

本卦 革     变卦 既济
世爻 = 第 4 爻 (亥 兄弟，旬空，动)
应爻 = 第 1 爻 (卯 子孙)
```

Notes on the chart:
- **革 → 既济** (Revolution → After Completion). Ge is about decisive
  change; Ji Ji literally means "already crossed" — a strong symbolic
  pairing for "should I take this leap."
- **世爻 旬空**: the querent's own line is void this cycle. The
  classical line "世居空地，终身作事无成" is exactly the warning
  signal here, but the LLM has to weigh it against the moving-line
  transformation (亥 → 申, 父母 回头生).
- **应爻 卯 vs 日辰 酉**: 应 clashes with day branch — the role or
  team may itself be in flux.

You can re-cast with a different time to see how the engine reacts:

```bash
# Cast at 3am — different 旬空, different 旺衰 labels
orbit divination chart --yao 7 8 7 9 7 8 \
  --datetime "2026-06-05T03:15:00+08:00" \
  --timezone 'Asia/Shanghai' \
  --question "Should I accept the senior engineer offer?" \
  --session sess_scenario_en_3am
```

### 2. Inspect the structured brief (no LLM cost)

```bash
# The deterministic ChartBrief — exactly the doc that gets fed to
# LLM #1 in the analyze pipeline. Useful for verifying the engine
# produced what you expected.
orbit divination brief --session sess_scenario_en

# Raw JSON if you want the full structured object:
orbit divination brief --session sess_scenario_en --json
```

### 3. Run the full 3-stage pipeline

```bash
# Without --debug: just the LLM's final answer
orbit chat --session sess_scenario_en "Should I accept the offer?"

# With --debug: full timeline — build brief → LLM #1 understand →
# RAG retrieve → LLM #2 synthesize
orbit chat --session sess_scenario_en "Should I accept the offer?" --debug
```

Expected `--debug` output (numbers vary by LLM provider; the shape
is what matters). Note: the LLM's analysis text comes back in
Chinese because the agent's system prompt and knowledge base are
in Chinese — this is intentional, since the product itself is a
Chinese liuyao reader. The LLM's `refinedQuestionType` /
`focusYongshen` / RAG queries are all in Chinese 六爻 terminology
(求事业, 官鬼, 世爻空亡, etc.) — they're proper-noun tokens, not
prose to translate:

```
Pipeline timeline
──────────────────────────────────────────────────────────
①  Build ChartBrief           0ms    lines=6
②  LLM #1 — Understand         ~7s   deepseek-v4-flash in=800 out=600
  [Understanding stage output]
    Refined question type: 求事业  (career)
    Focus 用神: 官鬼  (official-ghost, = the position itself)
    LLM-proposed RAG queries (3-4):
      · 六爻 工作 offer 官鬼 用神
      · 世爻空亡 动化回头生 事业
      · 官鬼两现 取用原则
      · 应爻冲 工作 变动
③  RAG retrieve                ~1s   queries=8 hits=32 deduped=7
  [RAG hits]
    Each query:
      · 六爻 工作 offer 官鬼 用神   hits=4  topScore=0.595
      · 世爻空亡 动化回头生 事业     hits=4  topScore=0.669
      · 官鬼两现 取用原则            hits=4  topScore=0.651
      · 应爻冲 工作 变动             hits=4  topScore=0.613
    Deduped top-k (with provenance):
      - 增删卜易.md            score=0.679 ← [六爻 其他]
      - 精华荟萃（下篇）.md    score=0.664 ← [世爻空亡 动化回头生 事业]
      - 实例应用.md            score=0.645 ← [六爻 其他]
      - 精华荟萃（上篇）.md    score=0.614 ← [六爻 其他]
      - 易经详解（下）.md      score=0.487 ← [革]
      - 装卦方法.md            score=0.477 ← [父母]
      - 易经详解（上）.md      score=0.397 ← [革]
④  LLM #2 — Synthesize         ~20s  deepseek-v4-flash in=3000 out=1800
──────────────────────────────────────────────────────────
Total: ~29s
```

### 4. Stand-alone analyze (bypasses /chat, hits the same code path)

```bash
# Save the chart JSON to a file first (any cast will do)
orbit divination chart --yao 7 8 7 9 7 8 \
  --datetime "2026-06-04T18:45:00+08:00" \
  --timezone 'Asia/Shanghai' \
  --question "Should I accept the senior engineer offer?" \
  --session sess_scenario_en_file 2>&1 | tail -20

# Then run analyze directly on the chart. This goes through the same
# 3-stage pipeline (brief → understand → RAG → synthesize) — just
# without the chat-loop wrapper. Add --debug to see the timeline.
orbit divination analyze <chart.json> --debug
```

### Health-check checklist

Run the scenario, then walk this table to confirm the system is healthy:

| Check | Expected |
|---|---|
| Correct model in footer | `orbit chat ...` ends with `[deepseek-v4-flash/deepseek • ...]`, **not** `[glm-.../zhipu • ...]` |
| Time block has all 4 pillars | Chart output shows `丙午年 / 癸巳月 / 己酉日 / 癸酉时` |
| Brief covers all 6 lines | `orbit divination brief` shows 6 lines of `- 第 N 爻 ...` |
| LLM #1 refines the question type | `--debug` timeline shows `Refined question type: 求事业` or similar |
| LLM #1 picks a sensible focus 用神 | Timeline shows `Focus 用神: 官鬼` (for this scenario) |
| RAG recall produces hits | Timeline shows `deduped=N` with N > 0 |
| Recall hits have source paths | `Deduped top-k` lines include `docs/base_knowledge/*.md` |
| Report contains `[cite: ...]` tags | LLM #2's final answer has at least 1 `[cite:` tag |
| Prompt cache hit on LLM #2 | `cacheHit > 0` on the synthesize call (the system prompt is stable) |

If any check fails:
- **Model is wrong**: your `~/.orbit/config.json` may still have
  `defaultProvider: zhipu`; the CLI passes it through unless you
  type `--model` explicitly. Either delete the file or pass
  `--model deepseek-v4-flash` per call.
- **RAG deduped = 0**: the embedder is probably the default hash
  embedder. Set `ORBIT_EMBEDDER=remote-zhipu` in `.env` and restart
  the server. The hash embedder is dependency-free but its recall
  is mediocre.
- **`cacheHit = 0`**: something is varying the system prompt between
  calls (e.g. a timestamp). Check `prompts/system/liuyao-agent.yaml`
  for any non-static content.

---

## Status

**First-step chart assembly**: complete. The deterministic engine
produces a fully-decorated chart for any of the 64 hexagrams (bits
or yaoValues input, with or without dayStem/dayBranch); no
`warnings[]` for the first-step data. dayStem/dayBranch/monthBranch/
hourBranch/xunkong are auto-derived from the caller's `datetime`
(or "now") via the [lunar-typescript](https://www.npmjs.com/package/lunar-typescript)
calendar skill (`src/liuyao/skills/calendarSkill.ts`); the time
block + xunkong are injected into the agent's system prompt so
the LLM can reason about 旺衰/冲合/动爻回头生克 from the actual
cast time.

**RAG**: the system corpus (`docs/base_knowledge/*.md`) is
auto-bootstrapped on every server start (see [src/app.ts](src/app.ts))
with a **contentHash cache** so only files whose body changed get
re-embedded. Default embedder is **Zhipu Embedding-3** (2048d,
OpenAI-compatible endpoint at `open.bigmodel.cn/api/paas/v4`,
0.5 元/Mtok). Swap with `ORBIT_EMBEDDER=hash` for dependency-free
local dev.

**Agent layer**: ships a working `default` agent that runs the
3-stage analysis pipeline (build brief → LLM #1 understand → RAG
retrieve → LLM #2 synthesize) → RAG-cited 6/9-section report. The
LLM is wired to refuse to recompute any chart field; it can only
interpret what's in the ChartResult.

**P2 work** (still TODO, surfaces as `warnings[]` on the chart
response): full 冲/合/刑/害/破 rules, full 用神 candidate rules,
quantitative 旺衰 scoring, 伏神/飞神, 化进/化退.

The chart pipeline's stage-by-stage table of which data is sourced
externally vs. computed inline is tracked in
`docs/liuyao/KNOWLEDGE_NEEDED.md` (P0 = 64-hexagram table, ✅).

---

## Glossary

The README keeps the canonical Chinese terms untranslated because
they are the same identifiers used in the code, CLI flags, system
prompts, and the dev token. The LLM's analysis output also comes
back in Chinese because the agent's system prompt and knowledge
base are in Chinese. This glossary maps the English descriptions
used in the prose to the proper-noun tokens you'll see throughout
the codebase:

| Chinese | English | Notes |
|---|---|---|
| 本卦 | original hexagram | the hexagram as cast |
| 变卦 | changed hexagram | the hexagram after flipping moving lines |
| 纳甲 | stem-branch assignment | the canonical 装纳甲 mapping of stems/branches to lines |
| 六亲 | six relatives | 父母/兄弟/子孙/妻财/官鬼 — derived from palaceElement vs lineElement |
| 六神 | six gods | 青龙/朱雀/勾陈/螣蛇/白虎/玄武 — derived from dayStem |
| 世爻 / 应爻 | world line / response line | the two key markers in any hexagram |
| 用神 | target spirit | the 六亲 the answer hinges on (e.g. 官鬼 for career) |
| 旬空 | xunkong / void | the 12-day window when a stem-branch pair is "empty" |
| 动爻 | moving line | yao values 6 (old yin) or 9 (old yang) — flips in the 变卦 |
| 旺衰 | strong / weak | a line's seasonal strength (旺/相/休/囚/死) |
| 冲合 | clash / combine | branch-to-branch relations (六冲, 六合, 三合, etc.) |
| 回头生/克 | reciprocating 生/克 | what a moving line's resulting branch does to the original |
| 父母 / 兄弟 / 子孙 / 妻财 / 官鬼 | parent / sibling / child / wife-wealth / official-ghost | the five 六亲 categories |
| 甲 / 乙 / 丙 / 丁 / ... | the 10 Heavenly Stems | dayStem / monthStem / yearStem / hourStem |
| 子 / 丑 / 寅 / ... | the 12 Earthly Branches | dayBranch / monthBranch / yearBranch / hourBranch |
| 64 卦 / 八宫 | 64 hexagrams / 8 palaces | the full hexagram table grouped by parent palace |

---

## License

MIT.
