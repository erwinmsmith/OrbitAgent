# OrbitAgent

> 六爻纳甲排盘、知识库检索与 LLM 分析 Agent 后端。

OrbitAgent 的目标不是让大模型自由“算卦”，而是把六爻业务拆成两层：

- **程序层负责算准**：起卦输入、阴阳动静、本卦/变卦、八宫、世应、纳甲、六亲、六神、旬空、冲合、动化、用神候选等确定性内容都由规则函数和硬编码表生成。
- **Agent 层负责说清楚**：LLM 只读取结构化排盘结果和知识库召回片段，生成可解释、有引用、能追问上下文的分析报告。

核心约束：**LLM 不允许重算或改写任何排盘字段**。如果程序层没有提供某个字段，Agent 必须说明缺失，而不是编造。

```text
用户问题 + 起卦输入
        |
        v
确定性排盘引擎
cast -> calendar -> hexagram -> palace -> najia -> sixRelative
     -> sixGod -> void -> branchRelation -> transformation
     -> yongshen -> strength -> fushen
        |
        v
ChartResult / ChartBrief  按 userId + sessionId 存入 Mongo
        |
        v
RAG 检索 docs/base_knowledge + 用户私有知识
        |
        v
LLM 分析 Agent 输出 6/9 段报告、引用、不确定性说明
```

## 业务场景

OrbitAgent 当前最适合做一个“六爻专业分析后端”，上层可以接 CLI、Web、小程序、私域工具或知识库研究台。

| 场景 | 用户问题 | 系统提供的能力 |
|---|---|---|
| C 端起卦解读 | 求财、求事业、求感情、求考试、求合同、求健康、求失物、求出行 | 用户输入 6 爻和问题，系统排盘、检索知识库、生成结构化报告 |
| 咨询师辅助工作台 | 咨询师已有卦例，需要快速装卦、标注用神、整理断语依据 | 程序稳定输出六亲、六神、世应、旬空、动化，LLM 负责形成可读草稿 |
| 六爻知识库产品 | 需要把经典文本、案例、规则表做成可检索资料库 | 系统语料 + 用户私有语料分层存储，RAG 检索按用户隔离 |
| 多轮追问 | 用户先起卦，再补充背景、候选方案、时间节点 | ChartStore 按 session 持久化卦盘，后续 chat 自动读取最新 chart |
| 多 Agent 分析 | 同一卦从用神、世应、时间、古例、动变等角度分开分析 | `analysisAgent` 支持 thinking 模式，按角度并行检索和分析后再综合 |
| API 集成 | 前端或其他系统只需要一个标准 REST 服务 | `/api/v1/divination/*`、`/api/v1/chat`、`/api/v1/models`、`/api/v1/usage` |

不适合直接交给 LLM 的内容应继续固化为函数或 skill：排盘、装卦、世应、纳甲、六亲、六神、旬空、日月建、生克冲合、旺衰、伏神飞神、化进化退、应期推断基础规则。

## 当前能力

| 模块 | 状态 | 说明 |
|---|---|---|
| 六爻排盘 | 可用 | 支持 `bits` 静爻输入和 `yaoValues` 动爻输入，按初爻到上爻排列 |
| 日时推导 | 可用 | 通过 `lunar-typescript` 从 `datetime` / 当前时间推导四柱、旬空、节气 |
| 64 卦表 | 可用 | `docs/base_knowledge/64卦数据.json` 是当前 canonical 数据源 |
| 纳甲、六亲、六神 | 可用 | 程序规则生成，不由 LLM 生成 |
| ChartStore | 可用 | Mongo 持久化，按 userId + sessionId + chartKey 隔离，默认 TTL |
| RAG 知识库 | 可用 | 自动 bootstrap `docs/base_knowledge/*.md`，支持用户私有上传 |
| 分析 Agent | 可用 | brief -> understand -> RAG -> synthesize 的多阶段报告链路 |
| 多 LLM | 可用 | DeepSeek、OpenAI、Anthropic、Gemini、Ollama、OpenAI-compatible provider |
| CLI | 可用 | `orbit login/chat/divination/models/skills/tools/workflows/usage` |
| Web 前端 | 可用 | Vite React + assistant-ui，邀请码访问，先起卦工作台、后追问对话 |
| P2 规则 | 部分可用 | 冲合刑害破、旺衰量化、伏神飞神、化进化退、完整用神取用仍需补强 |

## 仓库结构

```text
src/
  app.ts                         # Express 应用入口，挂载中间件、路由、服务初始化
  routes/                        # REST 路由：chat/auth/divination/memory/models/usage 等
  cli/                           # orbit 命令行客户端，所有业务逻辑仍走 REST API
  core/
    llm/                         # 多 provider LLM adapter 和模型路由
    memory/                      # Redis 临时记忆、Mongo ChartStore、PermanentMemory
    agents/                      # AgentLoader，读取 configs/agents.yaml
    skills/                      # 通用 chat preprocessing skill 管理器
    tools/                       # divination/filesystem/search/MCP tool 管理
    workflow/                    # YAML workflow engine
    prompts/                     # system prompt 加载
  liuyao/
    skills/                      # 六爻确定性 skill，chartAssembler 固定编排
    constants/                   # 天干地支、五行、纳甲、六神、64 卦等表
    agent/                       # ChartBrief、问题分类、分析报告生成
    rag/                         # Mongo-backed RAG、系统语料 bootstrap
    types/                       # 六爻领域类型
  models/                        # Mongoose models
  services/                      # database、DevAuth、TokenService、SkillInstaller
  users/                         # 用户资料、任务、公开 feed

configs/
  agents.yaml                    # agent 声明式注册
  tools.yaml                     # tool 配置
  workflows/conversation.yaml    # workflow 示例

prompts/system/
  default-agent.yaml
  liuyao-agent.yaml

docs/
  base_knowledge/                # 系统级六爻知识库语料
  liuyao/KNOWLEDGE_NEEDED.md     # 规则数据和缺失知识跟踪清单
```

## 完整使用说明

### 1. 环境准备

需要：

- Node.js 18+
- MongoDB，默认 `mongodb://localhost:27017/orbit_agent`
- Redis，默认 `redis://localhost:6379`
- 至少一个 LLM API key。默认配置使用 DeepSeek。

macOS 本地服务示例：

```bash
brew services start mongodb-community
brew services start redis
```

安装依赖并配置环境：

```bash
npm install
cp .env.example .env
```

至少在 `.env` 中配置一个可用 provider，例如：

```bash
DEEPSEEK_API_KEY=your_key
JWT_SECRET=replace_me_in_real_env
MONGODB_HOST=localhost
MONGODB_DATABASE=orbit_agent
REDIS_HOST=localhost
```

启动开发服务：

```bash
npm run dev
```

默认服务地址：

```text
http://localhost:3000
http://localhost:3000/api/v1/health
http://localhost:3000/api/v1/status/page
```

### 1.1 Web 前端

Web 版本在 `web/` 目录，使用 Vite React、assistant-ui 和同源 `/api/v1` 代理。开发时需要同时启动后端和前端：

```bash
npm run dev
npm run web:dev
```

默认访问：

```text
http://127.0.0.1:5173/
```

Web 交互流程：

1. 首次访问需要输入长期邀请码。
2. 邀请码首次使用时会绑定浏览器生成的 `deviceId`，同一邀请码后续需要在同一设备标识下使用；每个邀请码应只发给一个用户。
3. 登录后第一屏是起卦工作台，支持自动摇卦、手动六爻、时间、数字、汉字起卦。
4. 起卦完成后才进入追问对话；对话框固定在底部，等待起卦或回复时会显示转圈加载态。
5. 对话默认只显示短答。卦象和解读在输入框上方的“起卦资料”按钮中打开，可关闭；卦象会绘制本卦和有动爻时的变卦。
6. 默认 Web 展示会清理 `[cite: ...]` 和引用块，不暴露 RAG 标记；完整依据仍保留在服务端分析数据中。

生产构建：

```bash
npm run web:build
```

如果测试期间把邀请码绑定到了错误设备，上线前可以只清理设备绑定，不删除邀请码账号：

```bash
npm run invite:reset-bindings
```

清理后，每个邀请码会在下一次成功登录时重新绑定到对应用户当前设备。

### 2. CLI 指令完整说明

构建并链接 CLI：

```bash
npm run build
npm link
```

CLI 是 REST API 的薄客户端，不在本地重写业务逻辑。状态默认存在 `~/.orbit/`：

```text
~/.orbit/config.json    # baseUrl、默认 provider/model
~/.orbit/token.json     # 登录 JWT，后续命令自动带 Authorization
```

也可以用环境变量覆盖：

```bash
ORBIT_HOME=/tmp/orbit-demo
ORBIT_BASE_URL=http://127.0.0.1:3000/api/v1
ORBIT_PROVIDER=deepseek
ORBIT_MODEL=deepseek-v4-flash
```

#### 2.1 基础配置和登录

| 指令 | 作用 |
|---|---|
| `orbit` | 显示当前 base URL、home、登录用户 |
| `orbit --help` | 查看顶层帮助 |
| `orbit config show` | 查看 CLI 当前配置 |
| `orbit config set-base <url>` | 设置后端 API 地址，例如 `http://127.0.0.1:3000/api/v1` |
| `orbit config set-model <provider> <model>` | 设置 CLI 默认 provider/model |
| `orbit login --dev` | 开发环境直接获取 dev JWT |
| `orbit login --email <email> --password <password>` | 使用账号密码登录 |
| `orbit logout` | 清除本地 token |
| `orbit whoami` | 查看当前登录用户 |

常用初始化：

```bash
orbit config set-base http://127.0.0.1:3000/api/v1
orbit login --dev
orbit whoami
```

开发环境登录：

```bash
orbit login --dev
```

#### 2.2 六爻完整流程

| 指令 | 作用 |
|---|---|
| `orbit divination cast <b1> ... <b6>` | 只做 6 个 `0/1` bit 的起卦归一，输出 CastResult |
| `orbit divination cast-method coins` | 自动摇卦：模拟三枚硬币摇六次，输出 6 个爻值 |
| `orbit divination cast-method time` | 按时间起卦，输出上卦、下卦、动爻和 6 个爻值 |
| `orbit divination cast-method numbers 2 9 5` | 三数起卦，第 1 数取上卦、第 2 数取下卦、第 3 数取动爻 |
| `orbit divination cast-method character 财` | 汉字起卦，优先用现代笔画数，查不到用 Unicode 兜底 |
| `orbit divination chart [bits...]` | 生成完整 ChartResult，并存入 session |
| `orbit divination chart --yao <v1> ... <v6>` | 用 `6/7/8/9` 爻值排盘，支持动爻 |
| `orbit divination chart --method coins` | 使用结构化起卦方式排盘并存入 session |
| `orbit divination ask [bits...]` | 完整流程：起卦、排盘、保存、默认调用六爻 Agent 解卦 |
| `orbit divination ask --yao <v1> ... <v6> -q <question>` | 用动爻输入直接生成 RAG 解卦报告 |
| `orbit divination ask --method numbers --numbers 2 9 5 -q <question>` | 三数起卦后直接 RAG 解卦 |
| `orbit divination brief --session <id>` | 读取结构化 ChartBrief，不调用 LLM |
| `orbit divination brief --session <id> --json` | 输出完整 JSON brief |
| `orbit divination analyze <chart.json>` | 读取本地 chart JSON 并直接跑分析 Agent |
| `orbit divination analyze <chart.json> --debug` | 显示 brief、理解、RAG、综合阶段 timeline |
| `orbit chat --session <id> "<message>"` | 在已有卦盘 session 中多轮追问 |
| `orbit chat --session <id> "<message>" --debug` | 显示 chat 中触发的六爻分析 pipeline |

`chart` 常用参数：

| 参数 | 说明 |
|---|---|
| `-q, --question <text>` | 用户问题，用于用神和报告分析 |
| `--question-type <type>` | 手动指定问题类型，例如 `求财`、`求事业` |
| `--day-stem <stem>` | 手动指定日干，例如 `甲` |
| `--day-branch <branch>` | 手动指定日支，例如 `子` |
| `--month-branch <branch>` | 手动指定月支 |
| `--datetime <iso>` | 指定起卦时间；不传则默认当前时间 |
| `--timezone <tz>` | 指定时区，例如 `Asia/Shanghai` |
| `-s, --session <id>` | 保存卦盘的 session id |
| `--chart-key <key>` | 同一 session 下的卦盘名称，默认 `default` |
| `--method <method>` | 起卦方式：`manual`、`coins`、`time`、`numbers`、`character`；`auto` 等同随机三币 |
| `--numbers <a> <b> <c>` | `--method numbers` 的三数输入 |
| `--char <汉字>` | `--method character` 的单字输入 |
| `--yao` | 把 6 个位置参数解释为 `6/7/8/9` 爻值，而不是 `0/1` bits |

`ask` 额外参数：

| 参数 | 说明 |
|---|---|
| `--message <text>` | 起卦后写入 chat 的默认提示词，默认 `请结合卦象分析、解答问题` |
| `--thinking` | 开启多角度 thinking 分析，成本更高、速度更慢 |
| `--angles <n>` | thinking 模式分析角度数，服务端限制为 1-5 |
| `--debug` | 输出 RAG/LLM pipeline timeline，并在正文中保留 `[cite: ...]` 和 `## 引用` |
| `--json` | 输出原始 JSON |

起卦并存入 session：

```bash
orbit divination chart --yao 7 8 7 9 7 8 \
  --datetime "2026-06-04T18:45:00+08:00" \
  --timezone "Asia/Shanghai" \
  --question "我是否应该接受这份新工作 offer？" \
  --session sess_offer_demo
```

先看不消耗 LLM 的结构化 brief：

```bash
orbit divination brief --session sess_offer_demo
orbit divination brief --session sess_offer_demo --json
```

让 Agent 解读：

```bash
orbit chat --session sess_offer_demo "请结合卦象分析这个 offer 是否值得接受"
```

一步完成起卦、排盘和解卦：

```bash
orbit divination ask --yao 7 8 7 9 7 8 \
  --datetime "2026-06-04T18:45:00+08:00" \
  --timezone "Asia/Shanghai" \
  --question "我是否应该接受这份新工作 offer？" \
  --session sess_offer_demo_full
```

默认输出是干净解卦正文，不展示引用块，也会移除正文中的 `[cite: ...]` 标记。需要审计 RAG 命中和 LLM pipeline 时再加 `--debug`：

```bash
orbit divination ask --yao 7 8 7 9 7 8 \
  -q "我是否应该接受这份新工作 offer？" \
  --thinking \
  --angles 4 \
  --debug
```

使用函数化起卦入口：

```bash
# 只查看起卦归一结果，不排盘、不调用 LLM
orbit divination cast-method coins
orbit divination cast-method time --datetime "2026-06-04T18:45:00+08:00" --timezone Asia/Shanghai
orbit divination cast-method numbers 2 9 5
orbit divination cast-method character 财

# 起卦 → 排盘 → RAG 解卦，一步完成
orbit divination ask --method coins -q "这笔投资能不能赚钱？"
orbit divination ask --method time -q "此刻问这件事能成吗？"
orbit divination ask --method numbers --numbers 2 9 5 -q "这个 offer 是否值得接受？"
orbit divination ask --method character --char 财 -q "最近财运如何？"

# 结构化起卦同样支持 thinking 多角度分析
orbit divination ask --method coins -q "这笔投资能不能赚钱？" --thinking --angles 4
orbit divination ask --method character --char 财 -q "最近财运如何？" --thinking --angles 4 --debug
```

`--thinking` 会复用同一张排盘，从用神、世应、时间、动变、古例等角度分别 RAG 检索和分析，再综合成最终回答。`--debug` 只用于审计 pipeline 和引用；不加 `--debug` 时默认不展示引用信息。

查看多阶段 pipeline：

```bash
orbit chat --session sess_offer_demo "请详细分析" --debug
```

启用 **thinking 模式**（多角度分析，详见下节）：

```bash
orbit chat --session sess_offer_demo "请详细分析" --thinking --debug
orbit chat --session sess_offer_demo "请详细分析" --thinking --angles 4 --debug
```

只验证排盘，不进 LLM：

```bash
orbit divination chart 1 1 1 1 1 1 \
  --day-stem 甲 \
  --day-branch 子 \
  --session sess_static_qian

orbit divination brief --session sess_static_qian
```

指定 chartKey 保存多个卦盘：

```bash
orbit divination chart --yao 7 8 7 9 7 8 \
  --session sess_compare \
  --chart-key first \
  --question "方案一是否可行？"

orbit divination chart --yao 8 8 9 8 7 7 \
  --session sess_compare \
  --chart-key second \
  --question "方案二是否可行？"

orbit divination brief --session sess_compare --chart-key second
```

#### 2.3 Chat 指令

| 指令 | 作用 |
|---|---|
| `orbit chat "你好"` | 普通对话，默认 agent 是六爻 agent |
| `orbit chat --agent generic "你好"` | 使用 generic agent，避免六爻行为 |
| `orbit chat --session <id> "<message>"` | 复用同一个 session 多轮对话 |
| `orbit chat --stream "<message>"` | SSE 流式输出 |
| `orbit chat --model <model> --provider <provider> "<message>"` | 单次覆盖模型 |
| `orbit chat --system "<text>" "<message>"` | 临时追加 system prompt |
| `echo "..." \| orbit chat` | 从 stdin 读取消息 |

示例：

```bash
orbit chat --agent generic "用一句话介绍 OrbitAgent"
orbit chat --session sess_offer_demo "刚才这个卦，如果我延后一周再答复呢？"
echo "请总结这个报告" | orbit chat --agent generic
```

#### 2.3.1 交互式六爻 CLI 应用

`orbit liuyao` 是一个基于 **Ink** 的六爻 TUI 应用，CLI 中的 Agent 展示名是 **Roy**。它按「像素风三铜钱 Logo → 产品信息/注意事项 → 状态栏 → 工具执行块 → 排盘摘要 → Roy 流式回复」组织界面。新卦会调用 `/divination/ask` 生成完整报告，再调用 `/divination/summarize/stream` 由 LLM 生成交互式短答；追问会走 `/chat/stream`，并复用同一个 `sessionId`、Mongo permanent memory 和已保存卦盘。

```bash
orbit liuyao                                # 启动后选择起卦方式，回车默认自动摇卦
orbit liuyao --method manual                # 直接进入手动输入 6 个爻值
orbit liuyao --method coins                 # 自动摇卦
orbit liuyao --method time                  # 按当前时间起卦
orbit liuyao --method numbers               # 每次输入 3 个数字
orbit liuyao --method character             # 每次输入 1 个汉字
orbit liuyao --method coins --thinking --angles 4
orbit liuyao --no-rag-check                 # 跳过启动知识库检查
```

`orbit liuyao` 需要 TTY 终端。非交互脚本请使用 `orbit divination ask --method coins -q "问题"`。

启动时会先展示像素风三铜钱 Logo、产品信息、核心命令和注意事项。历史会话不会默认刷屏，需要通过 `/sessions` 调出：

```text
  ▓▓▓      ▓▓▓      ▓▓▓
 ▓   ▓    ▓   ▓    ▓   ▓
 ▓ ░ ▓    ▓ ░ ▓    ▓ ░ ▓
 ▓   ▓    ▓   ▓    ▓   ▓
  ▓▓▓      ▓▓▓      ▓▓▓
Orbit Liuyao · Roy
六爻排盘 · RAG 解卦 · 多轮追问 · Ink TUI
Commands: /new  /method  /sessions  /chart  /why  /rag  /tools  /help  /exit
注意：占断结果仅供参考；重大健康、法律、投资决策请以专业意见为准。
```

进入对话后，界面会保持固定的 `Status`、`Flow` 和底部 `Input`。轻量交互用单行 `你 >` / `Roy >`，只有排盘、检索、答案、会话管理等重信息才会用卡片。

如果没有传 `--method`，Roy 会先让你选择起卦方式：

```text
╭─ Status ───────────────────────────────────────────────────╮
│ session: new                                                │
│ method: coins    chart: none    mode: select_method          │
│ rag: on    memory: on    thinking: quick    kb: ready        │
│ Commands: /new  /method  /sessions  /chart  /why  /rag ...  │
╰─────────────────────────────────────────────────────────────╯
╭─ Flow ─────────────────────────────────────────────────────╮
│ ① 方式 ⠋   ② 问题 ·   ③ 推演 ·   ④ 起卦 ·   ⑤ 排盘 · ...    │
╰─────────────────────────────────────────────────────────────╯
╭─ Choose method ─────────────────────────────────────────────╮
│ > [2] 自动摇卦     模拟三枚硬币摇六次，适合标准六爻问事       │
│   [1] 手动六爻     输入 6 个 6/7/8/9，用于复盘或测试          │
│   [3] 时间起卦     按当前时间生成上卦、下卦和动爻             │
│   [4] 数字起卦     输入 3 个数字：上卦、下卦、动爻             │
│   [5] 汉字起卦     输入 1 个汉字，按笔画/时间取数             │
╰─────────────────────────────────────────────────────────────╯
你 > 2
Roy > 已切换为：自动摇卦 · coins。
```

起卦后默认展示流程进度、工作状态、排盘摘要、RAG 摘要和 **LLM 生成的流式短答**。这不是硬截断；完整报告仍保存在当前会话里，输入 `/why` 展开。完整六爻表、卦画、RAG 来源和工具调用都通过 slash commands 展开。

```text
你 > 这笔投资能赚钱吗
╭─ Analysis mode ─────────────────────────────────────────────╮
│ [1] 快速分析    直接给结论，适合普通问题                     │
│ [2] 深度推演    默认 3 angles，可输入 /think 5 调整           │
│ [3] 只排盘      当前版本会先生成 Chart，不调用短答请用 /chart  │
│ 默认：[1] 快速分析。也可以直接输入 /think 3。                 │
╰────────────────────────────────────────────────────────────╯
你 > /think 4

╭─ Flow ─────────────────────────────────────────────────────╮
│ ① 方式 ✓   ② 问题 ✓   ③ 推演 ✓   ④ 起卦 ⠋   ⑤ 排盘 · ...    │
╰────────────────────────────────────────────────────────────╯
╭─ Working ──────────────────────────────────────────────────╮
│ ⠋ 摇动三枚铜钱 / 生成起卦结果...                            │
╰────────────────────────────────────────────────────────────╯

╭─ Chart ────────────────────────────────────────────────────╮
│ 问题：这笔投资能赚钱吗                                      │
│ 起卦：coins · 8 7 8 8 8 7                                   │
│ 本卦：山水蒙        变卦：山水蒙        静卦                  │
│ 卦宫：离宫 · 四世 · 火                                      │
│ 动爻：无                                                    │
│ 世爻：第 4 爻 丙戌(土) 子孙 临朱雀                           │
│ 应爻：第 1 爻 戊寅(木) 父母 临白虎 旬空                      │
╰────────────────────────────────────────────────────────────╯
╭─ RAG ──────────────────────────────────────────────────────╮
│ ✓ 命中 6 条：世应、用神、动爻、卦象、旬空、六亲               │
│ 输入 /rag 查看检索依据。                                     │
╰────────────────────────────────────────────────────────────╯

Roy >
结论：这个卦需要谨慎，不适合只看收益而忽略风险。
关键依据：
  1. ...
  2. ...
  3. ...
你可以继续问：
  /why       看详细逻辑
  /chart     看排盘摘要
  /chart full 看完整卦画与六爻表
  /rag       看检索依据
  /new       重新起卦
```

第一次起卦完成后，普通输入会进入当前 session 的追问模式，不会重新起卦；需要重新起卦时输入 `/new`。

会话管理需要手动调出：

```text
你 > /sessions
╭─ Session manager ──────────────────────────────────────────╮
│ * 1. sess_cli_xxx  求财测试                                │
│   2. sess_cli_yyy  smoke test                              │
│ Commands: /use <sessionId>  /delete <sessionId>  /delete all│
╰────────────────────────────────────────────────────────────╯
```

交互页命令：

| 命令 | 作用 |
|---|---|
| `/new [method]` | 开启新卦；可选 `manual`、`coins`、`time`、`numbers`、`character` |
| `/method [method]` | 切换下一次新卦的起卦方式 |
| `/think off` | 切换为快速分析 |
| `/think 1-5` | 开启深度推演并指定角度数 |
| `/chart` | 查看当前排盘摘要 |
| `/chart full` | 展开本卦/变卦卦画、完整六爻表、六亲六神、世应、旬空、变爻 |
| `/why` | 展开分析摘要和完整报告；不是模型私密推理链 |
| `/rag` | 查看本轮检索依据，默认不展示 |
| `/rag check` | 手动检查 `docs/base_knowledge/*.md`，有变化才更新 embedding |
| `/tools` | 查看本轮工具调用：起卦、排盘、日历、检索、分析 |
| `/session` | 查看当前会话状态和当前卦上下文 |
| `/sessions` | 调出当前用户保存在 Mongo 的历史会话管理面板 |
| `/use <sessionId>` | 切换到已有 session，后续输入作为追问 |
| `/delete <sessionId>` | 删除某一个历史会话 |
| `/delete all` | 删除当前用户全部历史会话，需要谨慎使用 |
| `/history [sessionId]` | 查看当前或指定 session 最近消息 |
| `/export` | 导出当前报告到本地 markdown |
| `/clear` | 清屏并重绘当前状态栏 |
| `/exit` | 退出 |

退出：

```text
/exit
```

#### 2.4 RAG 知识库指令

| 指令 | 作用 |
|---|---|
| `orbit divination rag list` | 列出当前用户可见的系统文档和私有文档 |
| `orbit divination rag stats` | 查看 chunk/document 数量 |
| `orbit divination rag search <query...>` | 检索知识库 |
| `orbit divination rag search <query...> -k <n>` | 指定 top-k |
| `orbit divination rag upload <file.md>` | 上传私有 markdown 文档 |
| `orbit divination rag upload <file.md> --system` | 管理员上传系统级文档 |
| `orbit divination rag delete <source>` | 删除文档，source 从 `rag list` 复制 |
| `orbit divination rag rebuild` | 重建系统 RAG 索引 |

示例：

```bash
orbit divination rag list
orbit divination rag search "世爻空亡 动化回头生" -k 5
orbit divination rag upload my-notes.md
orbit divination rag upload docs/base_knowledge/新增卦例.md --system
orbit divination rag delete "my-notes.md"
```

#### 2.5 模型、用量、工具和 workflow

模型与用量：

| 指令 | 作用 |
|---|---|
| `orbit models` | 列出可用模型 |
| `orbit models --provider deepseek` | 只看某个 provider 的模型 |
| `orbit models --ids` | 只输出 model id，方便脚本使用 |
| `orbit health` | 查看 LLM provider 健康状态 |
| `orbit defaults` | 查看服务端默认 provider/model |
| `orbit switch <provider> <model>` | 切换服务端默认模型，并同步到本地 CLI config |
| `orbit usage` | 查看 token 用量统计 |
| `orbit pricing` | 查看模型价格表 |

示例：

```bash
orbit models --provider deepseek
orbit health
orbit defaults
orbit switch deepseek deepseek-v4-flash
orbit usage
orbit pricing
```

工具和 workflow：

| 指令 | 作用 |
|---|---|
| `orbit tools` | 列出已注册 tools 和入参 schema |
| `orbit exec <toolName> -p '<json>'` | 执行 tool |
| `orbit workflows` | 列出已加载 workflow |
| `orbit workflow-run <name> -c '<json>'` | 执行 workflow |

示例：

```bash
orbit tools
orbit exec filesystem -p '{"operation":"list","path":"."}'
orbit exec search -p '{"query":"六爻 回头生克","limit":3}'
orbit workflows
orbit workflow-run conversation -c '{"input":"你好"}'
```

说明：`divination` tool 主要给 chat-loop 内部使用，`analyze` / `inspect` 需要由 `/chat` 绑定当前用户和 session。命令行里做六爻分析时优先用 `orbit divination chart`、`orbit divination brief`、`orbit divination analyze` 或 `orbit chat --session <id>`。

#### 2.6 Skill 管理指令

这里的 `skills` 和 `skill` 是两组命令：

- `orbit skills`：查看当前服务加载的 skills。
- `orbit skill ...`：管理员安装、卸载、查看、重载 skill 文件。

| 指令 | 作用 |
|---|---|
| `orbit skills` | 列出已加载 skills |
| `orbit skill installed` | 列出服务器已安装 skills |
| `orbit skill show <id>` | 打印某个 skill 的 markdown 文件 |
| `orbit skill install <path-or-url>` | 从本地路径或 URL 安装 skill |
| `orbit skill install ignored --inline '<markdown>' --filename demo.md` | 以内联 markdown 安装 |
| `orbit skill uninstall <id>` | 卸载 skill，管理员权限 |
| `orbit skill reload` | 重扫 skill 目录 |

示例：

```bash
orbit skills
orbit skill installed
orbit skill show context-enrichment
orbit skill install ./skills/my-skill.md
orbit skill reload
```

### 3. 起卦输入规则

六爻顺序永远是 **初爻到上爻，自下而上**。

`bits` 适合静卦：

```bash
orbit divination chart 1 1 1 1 1 1 --session sess_qian
orbit divination chart 0 0 0 0 0 0 --session sess_kun
```

`yaoValues` 适合真实三枚铜钱起卦，支持动爻：

| 爻值 | 名称 | 阴阳 | 动静 |
|---|---|---|---|
| `6` | 老阴 | 阴 | 动，变阳 |
| `7` | 少阳 | 阳 | 静 |
| `8` | 少阴 | 阴 | 静 |
| `9` | 老阳 | 阳 | 动，变阴 |

示例：

```bash
# 第 3 爻老阳动
orbit divination chart --yao 7 7 9 7 7 7 --session sess_moving_3

# 第 1 爻老阴动
orbit divination chart --yao 6 8 8 8 8 8 --session sess_moving_1
```

除了手动输入，服务端还支持结构化 `casting`，这些都是程序函数生成，不交给 Agent 随机发挥：

| 起卦方式 | CLI method | 生成逻辑 | 动爻 |
|---|---|---|---|
| 手动输入 | `manual` | 直接接收 `bits` 或 `yaoValues` | 取决于输入 |
| 自动摇卦 | `coins` / `auto` | 六次模拟三枚硬币；正=3，反=2；每次和数即 `6/7/8/9` | 可能多个 |
| 时间起卦 | `time` | 公历年+月+日取上卦；再加时辰数取下卦和动爻；先天八卦数 | 1 个 |
| 数字起卦 | `numbers` | 三数法：第 1 数取上卦，第 2 数取下卦，第 3 数取动爻 | 1 个 |
| 汉字起卦 | `character` | 单字现代笔画数取上卦；笔画+时辰取下卦；笔画+日数+时辰取动爻；查不到笔画用 Unicode 码点 | 1 个 |

先天八卦数固定为：`1=乾`、`2=兑`、`3=离`、`4=震`、`5=巽`、`6=坎`、`7=艮`、`8=坤`。时间和汉字起卦默认时区为 `Asia/Shanghai`，也可以通过 `--timezone` 或 API 字段指定。

### 4. 使用 REST API

开发环境可以直接拿 dev token：

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/dev/token | jq -r .data.accessToken)
```

创建并保存卦盘：

```bash
curl -X POST http://localhost:3000/api/v1/divination/chart \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "sess_api_demo",
    "chartKey": "default",
    "yaoValues": [7,8,7,9,7,8],
    "datetime": "2026-06-04T18:45:00+08:00",
    "timezone": "Asia/Shanghai",
    "question": "我是否应该接受这份新工作 offer？"
  }'
```

读取 brief：

```bash
curl http://localhost:3000/api/v1/divination/brief/sess_api_demo \
  -H "Authorization: Bearer $TOKEN"
```

直接分析：

```bash
curl -X POST http://localhost:3000/api/v1/divination/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "sess_api_demo",
    "debug": true
  }'
```

通过 chat 多轮对话：

```bash
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "sess_api_demo",
    "message": "请结合世应、用神和动爻详细分析"
  }'
```

完整流程 API：

```bash
curl -X POST http://localhost:3000/api/v1/divination/ask \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "sess_api_full",
    "chartKey": "default",
    "yaoValues": [7,8,7,9,7,8],
    "datetime": "2026-06-04T18:45:00+08:00",
    "timezone": "Asia/Shanghai",
    "question": "我是否应该接受这份新工作 offer？",
    "message": "请结合卦象分析、解答问题",
    "thinking": true,
    "angles": 4
  }'
```

结构化起卦 API：

```bash
# 只起卦，不排盘
curl -X POST http://localhost:3000/api/v1/divination/cast \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "casting": { "method": "numbers", "numbers": [2, 9, 5] } }'

# 起卦 + 排盘
curl -X POST http://localhost:3000/api/v1/divination/chart \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "sess_api_casting",
    "casting": { "method": "character", "character": "财" },
    "datetime": "2026-06-04T18:45:00+08:00",
    "timezone": "Asia/Shanghai",
    "question": "最近财运如何？"
  }'
```

`casting.method` 支持 `manual`、`coins`、`time`、`numbers`、`character`；`auto` 是 `coins` 的别名。`/divination/chart` 和 `/divination/ask` 都会先把 `casting` 归一为 `yaoValues`，再调用同一套排盘和解卦逻辑。响应会返回 `casting` 元数据，便于复盘上卦、下卦、动爻、笔画数、时辰数或铜钱结果。

结构化起卦也可以直接开启多角度解卦：

```bash
curl -X POST http://localhost:3000/api/v1/divination/ask \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "sess_api_casting_thinking",
    "casting": { "method": "coins" },
    "question": "这笔投资能不能赚钱？",
    "thinking": true,
    "angles": 4,
    "debug": true
  }'
```

默认情况下，`/divination/ask` 的 `content` 是给终端和前端直接展示的干净正文，不包含 `## 引用`，也不显示 `[cite: ...]`。如果请求里传 `debug: true`，`content` 会保留引用信息，并额外返回 `debug.pipeline`、`debug.rag`、`debug.perAngle` 等审计数据。

`/divination/ask` 始终返回 `sessionId`、`chart`、`report`、`brief`、`content`；`debug` 只在 `debug: true` 时返回。服务端会把默认提示词和最终报告写入 Redis 临时记忆和 Mongo 永久会话，所以之后可以继续追问：

```bash
orbit chat --session sess_api_full "如果我延后一周再答复，会有什么变化？"
```

交互式 CLI 的短答不是字符串截断，而是额外调用 LLM summary 接口。非流式调用：

```bash
curl -X POST http://localhost:3000/api/v1/divination/summarize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "这笔投资能不能赚钱？",
    "chart": { "...": "ChartResult" },
    "content": "完整解卦报告正文"
  }'
```

流式调用使用 `POST /divination/summarize/stream`，返回 SSE `content` / `done` 事件。

单用户多会话管理使用 memory/chat 接口。`/chat` 会优先读取 Redis；如果 Redis 里没有当前 session，会从 Mongo permanent messages 回填上下文，再继续回答：

```bash
# 当前用户的永久历史会话
curl http://localhost:3000/api/v1/memory/permanent \
  -H "Authorization: Bearer $TOKEN"

# 指定 conversation 的永久消息
curl http://localhost:3000/api/v1/memory/permanent/<conversationId>/messages \
  -H "Authorization: Bearer $TOKEN"

# 按 sessionId 删除某一个永久会话
curl -X DELETE http://localhost:3000/api/v1/memory/permanent/session/sess_api_full \
  -H "Authorization: Bearer $TOKEN"

# 删除当前用户全部永久会话
curl -X DELETE "http://localhost:3000/api/v1/memory/permanent?confirm=true" \
  -H "Authorization: Bearer $TOKEN"

# 向指定 session 追问，不重新起卦
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "sess_api_full",
    "message": "刚刚我问了什么？"
  }'
```

上传私有知识：

```bash
curl -X POST http://localhost:3000/api/v1/divination/rag/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "my-case-notes.md",
    "body": "# 我的卦例\n..."
  }'
```

系统级知识需要管理员账号，并传 `scope: "system"`。

### 5. 主要 API

所有路由默认挂在 `/api/v1`。

| Method | Path | 作用 |
|---|---|---|
| `POST` | `/dev/token` | 开发环境获取 JWT |
| `POST` | `/auth/register` | 注册用户 |
| `POST` | `/auth/login` | 登录获取 JWT |
| `POST` | `/divination/cast` | 起卦归一：兼容 6 bits，也支持 `casting` 结构化起卦 |
| `POST` | `/divination/chart` | 生成完整 ChartResult，并保存到 ChartStore |
| `POST` | `/divination/ask` | 完整流程：起卦、排盘、保存、默认提示词解卦、写入 chat 临时记忆 |
| `POST` | `/divination/summarize` | 将完整解卦报告总结成交互式短答 |
| `POST` | `/divination/summarize/stream` | SSE 流式输出交互式短答 |
| `GET` | `/divination/brief/:sessionId` | 读取结构化 ChartBrief，不调用 LLM |
| `GET` | `/divination/chart/keys/:sessionId` | 查看当前用户在 session 下的 chartKey |
| `POST` | `/divination/analyze` | 直接分析 chart 或 session 中的最新 chart |
| `POST` | `/divination/rag/upload` | 上传 markdown 知识文档 |
| `GET` | `/divination/rag/list` | 查看可见知识文档 |
| `POST` | `/divination/rag/search` | 检索知识库 |
| `DELETE` | `/divination/rag/:source` | 删除自己或管理员有权删除的文档 |
| `POST` | `/chat` | 主对话接口 |
| `POST` | `/chat/stream` | SSE 流式对话 |
| `DELETE` | `/memory/permanent/session/:sessionId` | 删除当前用户某一个永久会话 |
| `DELETE` | `/memory/permanent?confirm=true` | 删除当前用户全部永久会话 |
| `GET` | `/models` | 模型列表 |
| `GET` | `/models/health` | provider 健康检查 |
| `GET` | `/usage/stats` | token 和成本统计 |
| `GET` | `/status/page` | 状态页面 |
| `GET` | `/docs` | API 文档页面 |

认证支持：

```text
Authorization: Bearer <jwt>
X-API-Key: <api-key>
```

响应统一为：

```json
{
  "success": true,
  "data": {}
}
```

或：

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "..."
  }
}
```

### 6. 配置说明

`config.yaml` 是结构配置源，`.env` 只放密钥和环境覆盖项。

关键配置：

- `app.host` / `app.port` / `app.apiPrefix`
- `database.mongodb.*`
- `redis.*`
- `llm.defaultProvider`
- `llm.defaultModel`
- 各 provider 的 models 列表
- MCP tools、agents、workflows 的 YAML 配置

RAG embedder 通过环境变量切换：

```bash
ORBIT_EMBEDDER=remote-zhipu
# 或本地无依赖开发
ORBIT_EMBEDDER=hash
```

### 7. 开发命令

```bash
npm run dev
npm run build
npm run start
npm run typecheck
npm run lint
npm run test
npm run test:unit
npm run test:integration
```

集成测试需要 MongoDB 和 Redis 可用。

## 分析 Agent 与 thinking 模式

`divination.analyze` 内部跑的是一个多阶段流水线。默认是 3 阶段；可
以通过 `thinking: true` 切到多角度模式。

### 默认 3 阶段（2 次 LLM 调用）

```
0  buildChartBrief               — 纯函数，确定性
1  LLM #1  understand            — brief + 问题 → JSON 计划
                                      (refinedQuestionType,
                                       focusYongshen, ragQueries,
                                       intermediateUnderstanding)
2  RAG     retrieve              — 跑 LLM 提出的查询 + 自动查询，去重
3  LLM #2  synthesize             — brief + 理解 + RAG → 6/9 段报告
```

适用：日常快速解读；成本低；一份报告 ~30s。

### thinking 模式（1 + N + 1 次 LLM 调用）

```
0  buildChartBrief                — 同上
1  LLM #1  understand + plan      — 同上，但同时返回 angles[]：
                                     3-5 个独立分析角度 + 每个
                                     角度专属的 RAG 查询
2  for each angle, in parallel:
     (a) searchMany(angle.queries)  — 每个角度跑自己的 RAG
     (b) LLM "analyze from this    — 300-500 字的单角度分析
         angle"  using (a)'s hits
3  LLM #N  synthesize              — brief + 理解 + N 个角度分析
                                     → 整合后的 6/9 段报告
```

适用：需要从多个独立视角深度分析的复杂问题；每个角度的 RAG 上下文不
串味；最终综合时把多角度的发现交叉对照。运行时间约 1.5–2 倍。

### 怎么开

CLI：

```bash
# /chat 路径
orbit chat --session sess_demo "..." --thinking
orbit chat --session sess_demo "..." --thinking --angles 4   # 1..5，默认 3
orbit chat --session sess_demo "..." --thinking --debug      # 看完整 timeline

# 独立 analyze 路径
orbit divination analyze chart.json --thinking
orbit divination analyze chart.json --thinking --angles 5 --debug
```

HTTP：

```bash
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "sessionId": "sess_demo",
    "message": "详细分析",
    "thinking": true,
    "angles": 3,
    "debug": true
  }'

curl -X POST http://localhost:3000/api/v1/divination/analyze \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "sessionId": "sess_demo",
    "thinking": true,
    "angles": 4,
    "debug": true
  }'
```

LLM 也可在调 `divination.analyze` 工具时直接传 `thinking: true,
angles: N`（[DivinationTool](src/core/tools/builtins/DivinationTool.ts) 的
schema 已支持这两个参数）。

### 默认角度

如果 LLM 在 Stage 1 没规划出 angles（或 LLM 不可用 fallback），分析
Agent 会用 4 个默认角度填充到 `--angles` 数量：

1. **用神与旺衰** — 用神候选的旺衰、是否空破、与日辰月令的生克
2. **世应与动变** — 世爻与应爻的五行生克，动爻化出的走向
3. **时间与月令** — 排盘时间（年/月/日/时四柱 + 节气）的影响
4. **古断参考** — 知识库里的类似卦例判辞

LLM 通常会基于问题类型和卦象，列出 1–2 个更有针对性的角度替代
默认值，比如 `动爻回头生`、`伏神飞神` 等。

### Debug 输出（`--debug` 或 `debug: true`）

thinking 模式展开后，pipeline timeline 多出来每个角度对应的
`rag-retrieve` 和 `angle-analyze` 步骤；`debug.perAngle[]` 数组列出每
个角度的：

- `name` / `perspective`：角度名 + 视角
- `ragQueries`：该角度专属的 RAG 查询
- `hits`：top-k 召回 + 来源追溯
- `analysis`：LLM 给出的单角度分析（含 `[cite: source]`）
- `model` / `provider` / `usage`：调用的模型 + token 消耗

CLI 渲染样例（`orbit chat --thinking --debug`）：

```
分析流程时间线 (pipeline)
──────────────────────────────────────────────────────────
①  构建 ChartBrief           0ms    lines=6
②  LLM #1 — 理解              8.2s   deepseek-v4-flash in=2.1k out=0.7k angles=3
③  RAG 召回  角度 1=用神与旺衰       1.2s   queries=3 deduped=3
③  RAG 召回  角度 2=世应与动变       0.9s   queries=3 deduped=4
③  RAG 召回  角度 3=时间与月令       1.1s   queries=3 deduped=5
④  角度分析  角度 1=用神与旺衰       15.8s  deepseek-v4-flash in=1.1k out=1.0k
④  角度分析  角度 2=世应与动变       12.9s  deepseek-v4-flash in=1.6k out=1.5k
④  角度分析  角度 3=时间与月令       12.5s  deepseek-v4-flash in=1.9k out=1.2k
⑤  LLM #N — 综合分析          18.7s  deepseek-v4-flash in=4.3k out=2.5k (merged 3 angles)
──────────────────────────────────────────────────────────
总耗时: 71.3s

[多角度分析 (thinking 模式)]
  角度数: 3

  角度 1：用神与旺衰
    perspective: ...
    RAG queries: 官鬼 旺衰 月令巳火, 官鬼 日辰酉金 泄气, 官鬼 旬空 寅卯 作用
    RAG hits (3):
      - docs/base_knowledge/增删卜易.md  ...
      - docs/base_knowledge/实例应用.md  ...
      - docs/base_knowledge/精华荟萃（上篇）.md  ...
    LLM 分析: 官鬼用神显于两处... [cite: docs/base_knowledge/...]
    tokens: in=1120  out=1027

  角度 2：世应与动变
    ...
```

## Skill、Workflow、函数和知识库的边界

后续开发时不要把所有东西都叫 skill。建议按下面边界处理：

| 类型 | 应放内容 | 当前或建议落点 |
|---|---|---|
| 纯函数 / 常量表 | 不需要上下文、可确定计算、必须单测覆盖的规则 | `src/liuyao/constants/*`、`src/liuyao/skills/*` 内部函数 |
| 六爻领域 skill | 一个明确领域动作，输入输出结构化，可被 assembler 编排 | `castSkill`、`calendarSkill`、`hexagramSkill`、`najiaSkill` 等 |
| Agent skill | 对 chat 输入做预处理或补充上下文，不负责排盘 | `src/core/skills/builtins/*`，例如意图识别、上下文补全 |
| Tool | Agent 可调用的外部动作，有权限边界和副作用 | `src/core/tools/builtins/DivinationTool.ts`、search、filesystem、MCP |
| Workflow | 多步骤业务流程，适合串联多个 tool / skill / agent stage | `configs/workflows/*.yaml` |
| 知识库 | 可被引用的文本、案例、断语、规则解释、出处 | `docs/base_knowledge/*`、Mongo RAG 文档 |
| Prompt | Agent 行为约束、输出格式、禁止事项 | `prompts/system/*.yaml`、`src/liuyao/agent/*` stage prompt |

### 已适合固化为 skill / 函数的内容

| 内容 | 建议 |
|---|---|
| 起卦归一化 | 已有 `castSkill` 和 `src/liuyao/casting/methods.ts`，三币、时间、数字、汉字都保持函数化，不做成 Agent skill |
| 日历四柱 | 已有 `calendarSkill`，需要补更严格的节气边界测试 |
| 64 卦识别 | 已有 `hexagramSkill`，保持表驱动和 snapshot 测试 |
| 八宫、世应 | 已有 `palaceSkill`，不交给 LLM |
| 纳甲 | 已有 `najiaSkill`，继续做全 64 卦覆盖测试 |
| 六亲 | 已有 `sixRelativeSkill`，保留五行生克推导 |
| 六神 | 已有 `sixGodSkill`，保留日干起六神 |
| 旬空 | 已有 `voidSkill`，建议从日柱推导而不是只按日干组近似 |
| 冲合刑害破 | 需要补完整规则和优先级，做成 `branchRelationSkill` 的确定性输出 |
| 动化关系 | 需要补回头生克、化进化退、化空化破，扩展 `transformationSkill` |
| 用神取用 | 需要把问题类型、六亲、世应、伏神、两现/多现规则固化为 `yongshenSkill` |
| 旺衰评分 | 需要把月建、日辰、动爻、空破、墓绝等转为结构化评分 `strengthSkill` |
| 伏神飞神 | 需要完整规则表和输出字段，完善 `fushenSkill` |

### 适合做成 workflow 的内容

| Workflow | 目的 |
|---|---|
| `first_divination_session` | 新用户首次起卦：收集问题、校验输入、排盘、生成简版报告 |
| `deep_analysis` | 标准报告 + thinking 多角度分析 + 引用整理 |
| `case_review` | 咨询师导入旧卦例，生成结构化标签、断语依据、复盘摘要 |
| `knowledge_ingestion` | 管理员上传资料，自动切片、标注来源、质量检查、入库 |
| `rule_regression_check` | 修改规则表后跑 64 卦、典型卦例、快照对比 |
| `frontend_session_flow` | 前端会话状态机：起卦、brief 预览、确认分析、追问 |

### 适合放知识库的内容

| 内容 | 用途 |
|---|---|
| 经典原文 | RAG 引用和解释依据，如《增删卜易》《黄金策》《卜筮正宗》 |
| 现代规则解释 | 帮助 LLM 用通俗语言解释用神、世应、动爻、空破 |
| 真实案例 | 给“类似卦例”检索和报告类比使用 |
| 断语模板 | 不直接替代判断，但可作为表达和结构参考 |
| 业务场景词典 | 把 offer、跳槽、合同、考试、复合、投资映射到六亲和问题类型 |
| 来源元数据 | 书名、章节、页码、版本、可信度、是否可外显引用 |

不要只把规则放进知识库。如果某条规则会影响排盘字段或判断标签，它应该先函数化，再把解释文字放进知识库。

## 开发计划

### P0：文档和可运行基线

- 统一 README、`README.zh.md`、`docs/README.md` 的定位，避免中英文和新旧能力互相矛盾。
- 给 `/divination/chart`、`/divination/ask`、`/divination/analyze`、`/chat` 增加最小可复制 curl 示例和响应字段说明。
- 固化一个 `sess_offer_demo` 端到端验收用例：排盘、brief、RAG、chat debug、报告引用都要可验证。
- 增加 schema 文档：`ChartResult`、`ChartBrief`、`AnalysisReport`、`RagCitation`。
- 保持开发顺序：先稳定 API，再补一次性命令行，再做交互式 CLI 应用，最后再接前端工作台。

### P1：确定性规则补完

- 完成 `branchRelationSkill`：六冲、六合、三合、半合、三刑、六害、六破、墓、绝、合化优先级。
- 完成 `transformationSkill`：回头生、回头克、化进、化退、化空、化破、化墓。
- 完成 `strengthSkill`：月令、日辰、动爻、生扶克泄耗、空破墓绝的分项评分。
- 完成 `yongshenSkill`：按问题类型取用神，处理用神两现、多现、伏藏、世应用神。
- 完成 `fushenSkill`：伏神、飞神、飞伏生克、伏神出伏条件。
- 为 64 卦全量生成快照测试，任何规则表修改都必须跑 regression。

### P1：知识补全

- 引入并结构化《卜筮正宗》《增删卜易》《黄金策》《易隐》《火珠林》相关章节。
- 补充问题类型知识：求财、事业、感情、婚姻、考试、合同、官司、疾病、失物、出行、合作、宠物。
- 补充应期规则：年月日时、动爻逢合冲、空亡填实、墓绝冲开、用神临值。
- 补充案例库：每类问题至少 20 个标注案例，字段包括问题、时间、卦盘、断语、结果、复盘。
- 给知识文档增加 metadata：来源、章节、可信度、适用场景、是否经典原文、是否现代解释。

### P2：Skill 化和函数化

- 继续扩展“三币起卦”“数字起卦”“时间起卦”“汉字起卦”的函数化结构化输入，不散落在 CLI 或前端，也不让 Agent 自行起卦。
- 为 `src/liuyao/casting/methods.ts` 补笔画字典、农历时间起卦变体、可配置取数规则和 API schema 文档。
- 把“问题类型分类 -> 用神候选 -> RAG query 生成”拆为可测试 pipeline，减少 LLM 随机性。
- 把“断语风险控制”做成 Agent skill：禁止绝对承诺、医疗/投资/法律场景必须加不确定性说明。
- 把“报告结构化输出”从纯 markdown 推进到 JSON schema + markdown render 双输出。
- 把 RAG query rewrite、chunk rerank、citation cleanup 做成独立模块。

### P2：Workflow 产品化

- 建立新用户起卦 workflow：问题收集、起卦方式选择、输入校验、排盘确认、报告生成。
- 建立专家模式 workflow：brief 可编辑注释、选择分析角度、选择知识库范围、导出报告。
- 建立知识入库 workflow：上传、去重、切片、metadata 标注、召回测试、发布到 system scope。
- 建立规则发布 workflow：改规则表、跑测试、生成 diff、验证典型卦例、记录版本号。

### P3：产品和工程能力

- 前端工作台：起卦输入、卦盘可视化、brief 检查、报告阅读、引用展开、追问。
- CLI 应用增强：`orbit liuyao` 支持会话内追问、历史列表、知识库切换、报告导出、配置面板。
- Admin 控制台：用户、API key、provider、模型成本、知识库、RAG 质量、系统状态。
- 可观测性：pipeline timeline、LLM token/cost、RAG hit rate、引用覆盖率、失败告警。
- 部署：Docker Compose、生产环境配置模板、Mongo/Redis 备份、日志轮转、健康探针。
- 权限：系统知识库管理员、咨询师、普通用户、API client 分级。
- 数据闭环：用户反馈、报告质量评分、案例结果回填、错误排盘回放。

## 关键原则

- 排盘相关内容优先函数化，LLM 只解释。
- 会影响判断标签的规则不能只放知识库。
- 知识库必须有来源和适用范围，否则引用价值很低。
- Workflow 编排业务过程，Skill 做单一结构化能力。
- 所有多用户数据默认按 userId 隔离。
- 每个新增规则都要有单元测试、典型卦例和回归用例。

## License

MIT.
