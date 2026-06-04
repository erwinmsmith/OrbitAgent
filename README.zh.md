# OrbitAgent

> [English](README.md) | **简体中文**

**六爻纳甲起卦 + LLM 解读** 的多用户 AI 后端。

程序层做确定性排盘（本卦 / 变卦、纳甲、六亲、六神、世应、旬空），
LLM 层负责把排盘结果组织成可读的分析报告并和用户对话。所有规则
表（64 卦、八宫纳甲、六亲六神、旬空、日干支）全部硬编码 —— LLM
不会"算"，只会"说清楚"。

```
                ┌─────────────────────────────────────┐
                │  确定性排盘引擎                       │
                │  ────────────────────────────────  │
   6 bits ──►   │  cast → hexagram → palace → 纳甲   │  ──►  ChartResult
   or 6 yao     │  → sixRel → sixGod → void …        │      (存于 Mongo)
                │                                     │
                └─────────────────────────────────────┘
                                │
                                ▼
                ┌─────────────────────────────────────┐
                │  LLM 分析 Agent（按用户隔离）        │
                │  ────────────────────────────────  │
                │  • 只读 ChartResult 字段            │
                │  • 引用 RAG 片段（Mongo + 检索）     │
                │  • 绝不重算任何排盘字段              │
                │  • 生成 6 / 9 段报告                │
                └─────────────────────────────────────┘
```

核心原则（来自 [design.md](design.md)）：**程序负责"算准"，Agent
负责"说清楚"**。LLM 不得重算任何排盘字段；字段缺失时必须如实说明。

---

## 六爻子系统的内容

排盘引擎（[src/liuyao/](src/liuyao/)）随项目发布，开箱即用，包
含完整的第一段确定性流水线：

- **64 卦表** —— `docs/base_knowledge/64卦数据.json`（卦辞、爻辞、
  世应、符号、八宫归属）在模块初始化时加载，并按
  `HEXAGRAMS_BY_BITS` / `HEXAGRAMS_BY_NAME` / `HEXAGRAMS_BY_ID` 重
  新建索引。每个卦的卦宫、palaceType（本宫 / 一世 / ... / 归魂）、
  五行都由（上卦 / 下卦）这一对经卦推得。
- **13 个 skill** 由 `chartAssembler.ts` 固定顺序编排：
  `cast → hexagram → palace → najia → sixRelative → sixGod → void →
   branchRelation → transformation → yongshen → strength → fushen`
  （部分 P2 占位会优雅地返回 `warnings[]` 而不是抛错）。
- **纳甲** —— 全部 8 经卦 × 内外 × 3 爻（96 单元），源自标准装纳
  甲歌诀。
- **六亲** —— 由 `palaceElement` 与 `lineElement` 的五行生克推得。
- **六神** —— 由 `dayStem` 推得（甲乙起青龙，丙丁起朱雀，…）。
- **旬空** —— 由 `dayStem` 推得（5 个日干组）。
- **RAG 知识库** —— `docs/base_knowledge/*.md` 自带六爻语料
  （装卦方法、六爻卦理、易经详解、实例应用、装卦补充 + 64 卦数
  据.json）。RAG 存储后端为 Mongo（`knowledge_documents` +
  `knowledge_chunks` 集合），按用户隔离：每个用户看到系统语料
  + 自己的私有上传，**不会**看到其他用户的私有上传。

### 两步走流程（用户 + Agent）

默认每次对话都是占卜对话。流程有意拆开，让 LLM 永远不重算排盘：

```
$ orbit divination chart 1 1 1 1 1 1 \
    --day-stem 甲 --day-branch 子 --session sess_demo
✓ Chart assembled and stored.
  orig: 乾   changed: 乾   palace: 乾宫 · 本宫 · 金
  shi/ying: 6/3   moving: none

$ orbit chat --session sess_demo "这次求财能成吗?"
完整 6 段报告 + RAG 引用
```

排盘结果持久化在 `ChartStore`（Mongo，24h TTL，按用户隔离），以
sessionId 为主键。Agent 通过 `divination` 工具（单 action：`analyze`）
回读，由 `runAnalysisAgent` → `buildReport` → RAG 增强的 6 / 9 段
报告链路生成最终解读。Agent 永远看不到原始 bits。

### 排盘的两种输入

```bash
# 静态阴阳（无动爻）
orbit divination chart 1 1 1 1 1 1 --day-stem 甲 --day-branch 子

# 6 / 7 / 8 / 9 爻值（支持动爻 6、9）
orbit divination chart --yao 7 7 7 7 9 7 --day-stem 甲 --day-branch 子
```

CLI 会回显一行确定性输出摘要（本卦、变卦、卦宫 + 世 / 应、6 爻 ×
纳甲 / 六亲 / 六神），方便你在把结果交给 LLM 之前先确认引擎产出
是否符合预期。

bits / yao 编码详见 CLI 的 `--help` 和
`docs/base_knowledge/装卦方法.md`。

### 爻值编码

一个卦由 6 爻自下而上组成（初爻在 1 位即最底，上爻在 6 位即最
顶）。每爻有两个属性：阴阳，以及（对动爻而言）翻转标志。
OrbitAgent 接受两种等价的编码：

| 编码 | CLI 形式 | 静爻 | 动爻 | 备注 |
|---|---|---|---|---|
| `bits` | `orbit divination chart 0 1 1 0 1 1` | `0` = 阴，`1` = 阳 | **不支持** | 最简单的输入 —— 每爻一个 0/1，自下而上。内部映射到 yao `8`（阴）和 `7`（阳）。无老阳 / 老阴，所以无动爻。 |
| `yaoValues` | `orbit divination chart --yao 7 7 9 7 8 6` | `7` = 少阳，`8` = 少阴 | `9` = 老阳（→ 翻成阴），`6` = 老阴（→ 翻成阳） | 当你需要动爻时用这个。按自下而上的顺序给 6 个数。 |

4 个爻值来自标准火珠林（刘一）三铜钱法。如果你想自己起卦、不让
CLI 帮你算：

```
3 枚铜钱（背面=0，正面=1）     yao 值   名     爻性
0 背 3 正   （交）              6       老阴   阴，动
1 背 2 正   （单）              7       少阳   阳，静
2 背 1 正   （拆）              8       少阴   阴，静
3 背 0 正   （重）              9       老阳   阳，动
```

比如你掷出 1 背 2 正，这一爻就是少阳 = 7。重复 6 次填满 6 爻，
自下而上排好，然后 `--yao` 传给 CLI。

**方向很关键**。6 个数永远按 **自下而上**（初爻 → 上爻）给。
`orbit divination chart 1 1 1 1 1 1` 是乾（六阳），`0 0 0 0 0 0`
是坤（六阴）。顺序反了就是综卦。

**例子**：

```bash
# 乾（六爻皆阳，静）
orbit divination chart 1 1 1 1 1 1

# 坤（六爻皆阴，静）
orbit divination chart 0 0 0 0 0 0

# 乾第 3 爻动（老阳 → 翻成阴）
orbit divination chart --yao 7 7 9 7 7 7

# 坤第 1 爻动（老阴 → 翻成阳）
orbit divination chart --yao 6 8 8 8 8 8

# 真实三铜钱起卦：每掷得一爻，自下而上排
# 例如掷出 拆 拆 重 拆 单 单 → 8 8 9 8 7 7
orbit divination chart --yao 8 8 9 8 7 7
```

**为什么两种编码**？`bits` 是快速测试和不关心动爻的场景下最方
便的默认；`yaoValues` 是真正掷过铜钱、或要引擎渲染带 动爻化出
的 变卦 时用的。

---

## 框架能力

六爻子系统之下，OrbitAgent 是一个单进程 Express 服务，带有生产级
LLM 后端应有的所有标准件。你不需要了解这些就能使用六爻产品；要
扩展时才需要。

### 多 LLM 支持

10+ provider、25+ model，全部走一套 adapter 接口
（[src/core/llm/](src/core/llm/)）。原生 adapter（`anthropic`、
`openai`、`google`、`ollama`、`deepseek`）有 API key 即注册；
OpenAI 兼容 adapter（`kimi`、`siliconflow`、`groq`、`together`、
`perplexity`）共用一个基类，对应的 `<PROVIDER>_API_KEY` 环境变量
存在即自动注册。Model ID 全局唯一，路由表做一次线性扫描即可。

默认六爻 agent 用 `deepseek-v4-flash` —— system prompt + skill /
tool 列表一共约 1280 token，prompt cache 100% 命中，按命中价算下
来每次起卦分析几乎免费。

### 多用户隔离

凡是持有用户私有业务数据的存储都按 `userId` 隔离，跨用户访问会
被拒绝：

- `ChartStore`（[src/core/memory/ChartStore.ts](src/core/memory/ChartStore.ts)）——
  一图对应 `(userId, sessionId, chartKey)`，Mongo 后端，带 TTL 索
  引，跨用户读直接抛错。
- `PermanentMemory` —— `Conversation` + `Message` 集合按 userId 隔
  离；永久存储是 opt-in，需先 `POST /api/v1/memory/permanent` 创建
  conversation。
- RAG —— `knowledge_documents` + `knowledge_chunks` 集合，
  `scope=system`（管理员维护）或 `scope=user`（每用户上传）；检索
  时只把系统语料 + 当前用户的私有语料合并返回。覆盖测试见
  `tests/integration/multi-user-isolation.test.ts`（13 个 case 的
  跨用户访问矩阵）。

### Agents / Skills / Tools / Workflows

- **Agents**（[configs/agents.yaml](configs/agents.yaml)）—— 声明式
  YAML 注册表；自带 `default`（= liuyao）、`generic`、`coding` 三
  个 agent。新增 agent：在 `agents.yaml` 追加一条，在
  `prompts/system/<id>.yaml` 放一个 prompt，重启。
- **Skills** —— chat 流水线上的预处理钩子；内建 skill 位于
  `src/core/skills/builtins/`。CLI 提供 `orbit skill install <url|text>`
  和 `orbit skill uninstall <id>`（仅管理员）。
- **Tools** —— `divination`（liuyao）、`filesystem`、`search`，以
  及 `config.yaml` 里声明的 MCP server。按 agent 过滤工具：六爻
  agent 只能看到 `divination`；`coding` agent 看到 `filesystem` 和
  `search`。
- **Workflows** —— YAML 定义位于 `configs/workflows/`，每 60 秒
  热重载。

### 鉴权

双方案：`X-API-Key`（哈希存储，按权限）和 JWT（`Authorization: Bearer
…`）。两个中间件默认都不阻断，按链式顺序执行；管理员路由再叠
`adminOnly`。`orbit login --dev` 会给 dev 用户直接签 30 天 JWT，
方便你跳过完整登录流程。

dev 环境（`NODE_ENV !== 'production'`）下自动 seed 两个用户：

- Admin：`admin@orbit.local` / `orbit_admin_2026`
- Test：`dev@test.local` / `devpassword123`

---

## 快速上手

### 依赖

- Node.js 18+
- MongoDB（默认 `mongodb://localhost:27017/orbit_agent`）
- Redis（默认 `redis://localhost:6379`）

```bash
# macOS
brew services start mongodb-community
brew services start redis
```

### 安装 + 启动

```bash
npm install
cp .env.example .env          # 至少填一个 LLM API key
npm run dev                   # ts-node + dotenv 热加载
```

服务跑在 `http://localhost:3000`。健康检查：`GET /api/v1/health`。

### 3 步完成第一次六爻占卜

```bash
# 1. 取一个 dev JWT
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/dev/token | jq -r .data.accessToken)

# 2. 起卦
curl -X POST http://localhost:3000/api/v1/divination/chart \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"bits":[1,1,1,1,1,1], "sessionId":"sess_demo",
       "dayStem":"甲", "dayBranch":"子",
       "question":"求财"}'

# 3. 让 Agent 解读
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sessionId":"sess_demo", "message":"这次求财能成吗?"}'
```

### CLI

```bash
# 安装二进制
npm run build && npm link

# 登录（dev 模式）
orbit login --dev

# 起卦 + 对话
orbit divination chart 1 1 1 1 1 1 --day-stem 甲 --day-branch 子 \
  --question "求财" --session sess_demo
orbit chat --session sess_demo "帮我分析"
```

`orbit` 二进制是同一套 REST API 的薄壳客户端，不重复实现任何业务
逻辑。状态文件位于 `~/.orbit/`（可用 `ORBIT_HOME` 覆盖）。

### RAG：上传你自己的六爻知识

```bash
# 上传一个 markdown（成为 user-scope，私有于你）
orbit divination rag upload my-notes.md
orbit divination rag list

# 管理员可以追加到系统知识库
orbit divination rag upload my-system-doc.md --system
```

---

## 配置

[config.yaml](config.yaml) 是结构 / 形态的真相源；[.env](.env) 只
放密钥和 host / port 覆盖。`config.yaml` 把 `${VAR}` 和
`${VAR:default}` 占位符对 `process.env` 做替换，并用 zod 校验合并
后的树。

`config.yaml` 中声明的 provider model 列表驱动 `/api/v1/models` 的
API 输出。

按 model 的 token 定价（USD / 百万 token，含 prompt cache 命中的
`cacheHitPricePerM`）放在 [src/models/TokenUsage.ts](src/models/TokenUsage.ts)——
新增 model 的定价加在那里，不要加到 `config.yaml`。

---

## API 接口

所有路由挂载在 `app.apiPrefix`（默认 `/api/v1`）下。鉴权路由接受
`Authorization: Bearer <jwt>` 或 `X-API-Key: …` 之一。响应统一信封：
`{ success, data?, error?: { code, message, details? } }`。

| Method | Path | 备注 |
|---|---|---|
| `POST` | `/divination/chart` | 6 bits 或 6 yao 值 + dayStem / dayBranch → 完整排盘，按 session 持久化到 ChartStore |
| `POST` | `/divination/analyze` | 按 sessionId 读取已存排盘（或直接传 inline chart）→ AnalysisReport |
| `GET` | `/divination/chart/keys/:sessionId` | 列出该 session 下的 chartKey |
| `POST` | `/divination/rag/upload` | 摄取一个 markdown 文档（user-scope；管理员可传 `scope=system`） |
| `GET` | `/divination/rag/list` | 列出当前用户可见的文档 |
| `POST` | `/divination/rag/search` | Top-k 片段（按 scope 隔离） |
| `DELETE` | `/divination/rag/:source` | 删除一个文档（支持裸文件名，server 端解析） |
| `POST` | `/chat` | 主对话入口；`agentId` 默认为 `default`（= liuyao） |
| `POST` | `/chat/stream` | SSE 流式 |
| `POST` | `/auth/login` / `/auth/register` | JWT 鉴权 |
| `GET` / `POST` | `/users/*` | 用户资料、签到、ritual 任务记录、公开 feed |
| `GET` | `/models` | 可用 model 列表 |
| `GET` | `/models/health` | LLM provider 健康表 |
| `GET` | `/usage/stats` | token 消耗汇总 + byModel + daily |
| `GET` | `/health` | `{ status: "healthy", uptime }` |
| `POST` | `/dev/token` | （仅 dev）跳过登录取 JWT |

错误码命名空间：`1000=auth`，`2000=validation`，`3000=resource`，
`4000=LLM`，`5000=memory`，`6000=skills`，`7000=tools`，
`8000=workflow`，`9000=system`。完整列表见 [API_DOC.md](API_DOC.md)。

---

## 项目结构

```
src/
  app.ts                       # Application 类 — 装配中间件、路由、服务，跑启动健康检查
  liuyao/                      # 六爻子系统（默认产品）
    skills/                    # 13 个确定性 skill
      chartAssembler.ts        #   按固定顺序编排这 13 个 skill
      castSkill.ts             #   6 bits / yaoValues → 6 爻值
      hexagramSkill.ts         #   bit 模式 → 64 卦表查找
      palaceSkill.ts           #   卦宫 + 世 / 应
      najiaSkill.ts            #   纳甲（干支 + 五行）
      sixRelativeSkill.ts      #   六亲（五行生克）
      sixGodSkill.ts           #   六神（日干 → 起神）
      voidSkill.ts             #   旬空 + 标记空爻
      branchRelationSkill.ts   #   冲 / 合 / 刑 / 害（P2 占位）
      transformationSkill.ts   #   动爻化出（P2 占位）
      yongshenSkill.ts         #   用神候选（P2 占位）
      strengthSkill.ts         #   旺衰标签（P2 占位）
      fushenSkill.ts           #   伏神（P2 占位）
    agent/
      analysisAgent.ts         #   runAnalysisAgent — 3 阶段流水线
      chartBrief.ts            #   buildChartBrief — 结构化材料
      reportTemplate.ts        #   6 / 9 段报告构建器
      questionClassifier.ts    #   question type → 用神 hint
    rag/
      index.ts                 #   Mongo 后端 RAG，按用户隔离
    constants/                 # 排盘表：64 卦、纳甲、五行……
    types/                     # 排盘 TypeScript 类型（basic / chart / skill / agent）
  core/
    llm/                       # 多 provider LLM adapter
    memory/                    # TemporaryMemory（Redis）+ ChartStore（Mongo）
    agents/                    # AgentLoader（configs/agents.yaml）
    skills/                    # 通用 skill 流水线（chat 预处理）
    tools/                     # divination、filesystem、search、MCP
    workflow/                  # YAML workflow 引擎
    prompts/                   # System prompt 加载器
  users/                       # 用户系统（ritual 任务、profile、feed）
  routes/                      # Express 路由（chat、auth、divination……）
  models/                      # Mongoose 模型
  services/                    # database、DevAuth、TokenService、SkillInstaller
  middleware/                  # auth、errorHandler
  cli/                         # `orbit` 二进制（薄壳 REST 客户端）

docs/
  base_knowledge/              # 六爻知识库（system-scope RAG 语料）
    64卦数据.json              #   64 卦表（canonical source）
    装卦方法.md                #   装卦 + 装六亲 + 装六神规则
    六爻卦理.md                #   六爻卦理 reference
    六爻基础.md                #   入门
    六爻用神.md                #   用神规则
    实例应用.md                #   实例
    排盘补充.md                #   排盘补充（干支、五虎五鼠遁、旬空、64 卦详表）
    易经详解（上/下）.md       #   易经详解
    精华荟萃（上/下篇）.md     #   精华
    起卦方法.md                #   起卦

design.md                      # 系统设计文档（排盘流程 + skill 列表）
CLAUDE.md                      # 给 AI 助手的项目说明
```

---

## 开发

```bash
npm run dev          # ts-node + dotenv 热加载
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # jest
npm run test:unit    # 仅单元测试（76 / 76 通过 — 覆盖排盘第一段）
npm run test:integration  # 仅集成测试（28 / 28 通过 — 需 Mongo + Redis）
```

路径别名（`@core/*`、`@config/*`、`@routes/*`……）在
[tsconfig.json](tsconfig.json) 和 [jest.config.js](jest.config.js)
两处都定义 —— 新增别名时这两处都要更新。

---

## 测试场景 —— 大厂 offer

一个可复现的端到端场景，跑完整的多阶段分析流水线。重构后用来
做 sanity check，或者按这个走一遍熟悉整个系统。

> **背景**：一位有两年经验的后端工程师，刚收到一家大厂高级工程
> 师的 offer。面试约在下周二，TA 辗转反侧想用六爻问一卦。
>
> **问题**：*"这次大厂高级工程师 offer 该不该接？"*
>
> **起卦时间**：当前时间（Asia/Shanghai）。可传 `--datetime` 覆盖。
>
> **预期分析角度**：
> - 官鬼是首要用神 —— 代表职位 / offer 本身。
> - 世爻代表问卦人自身状态；本场景世在四爻，落旬空。
> - 应爻代表雇主 / 团队。
> - 第 4 爻动（老阳 → 翻成申金父母），卦中有真动变可读。

### 1. 起卦

```bash
# 6 枚铜钱 = yao 值 7 8 7 9 7 8（第 4 爻老阳 → 动）。
# 不传 --day-stem / --day-branch — 由程序从 --datetime 经
# lunar-typescript 日历 skill 推导。
orbit divination chart --yao 7 8 7 9 7 8 \
  --datetime "$(TZ='Asia/Shanghai' date '+%Y-%m-%dT%H:%M:%S+08:00')" \
  --timezone 'Asia/Shanghai' \
  --question "这次大厂高级工程师 offer 该不该接？" \
  --session sess_interview_zh
```

引擎输出：

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

对这张盘的解读要点：
- **革 → 既济**（Revolution → After Completion）。革主变革，既济
  意为"事已渡过" —— 名字本身就在暗示"敢变 + 能成"。
- **世爻旬空**：古书"世居空地，终身作事无成"是直接的警告，但
  动爻化出（亥 → 申，父母回头生）给了一线转机，LLM 需要权衡。
- **应爻卯 vs 日辰酉**：应爻受日冲，暗示公司或岗位本身在变动。

可以换时间重起一卦，看引擎的反应：

```bash
# 凌晨 3 点起卦 —— 旬空、旺衰标签都会变
orbit divination chart --yao 7 8 7 9 7 8 \
  --datetime "2026-06-05T03:15:00+08:00" \
  --timezone 'Asia/Shanghai' \
  --question "这次大厂高级工程师 offer 该不该接？" \
  --session sess_interview_zh_3am
```

### 2. 查看结构化 Brief（不消耗 LLM 额度）

```bash
# 排盘引擎产出的确定性文档 —— 正是流水线中喂给 LLM #1 的那份。
# 用来在不调 LLM 的前提下核对引擎结果。
orbit divination brief --session sess_interview_zh

# 想看原始 JSON：
orbit divination brief --session sess_interview_zh --json
```

### 3. 跑完整 3 阶段流水线

```bash
# 不带 --debug：只看到 LLM 的最终回答
orbit chat --session sess_interview_zh "这次大厂 offer 该不该接？"

# 带 --debug：看到 build brief → LLM #1 理解 →
# RAG 召回 → LLM #2 综合分析 整条时间线
orbit chat --session sess_interview_zh "这次大厂 offer 该不该接？" --debug
```

期望的 `--debug` 时间线（数字随 LLM provider 浮动，看形状即可）：

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

### 4. 独立 analyze（不走 /chat，走同一条代码路径）

```bash
# 先把 chart JSON 存到文件
orbit divination chart --yao 7 8 7 9 7 8 \
  --datetime "2026-06-04T18:45:00+08:00" \
  --timezone 'Asia/Shanghai' \
  --question "这次大厂 offer 该不该接？" \
  --session sess_interview_zh_file 2>&1 | tail -20

# 直接对 chart 跑 analyze。这跟 /chat 内部的 divination.analyze 是
# 同一条流水线（brief → 理解 → RAG → 综合分析），只是少了 chat
# loop 的包装层。加 --debug 可以看时间线。
orbit divination analyze <chart.json> --debug
```

### 健康检查清单

跑完场景后，对照这张表确认系统健康：

| 检查项 | 预期 |
|---|---|
| footer 中模型正确 | `orbit chat ...` 末尾是 `[deepseek-v4-flash/deepseek • ...]`，**不**是 `[glm-.../zhipu • ...]` |
| 排盘 time block 含 4 柱 | chart 输出有 `丙午年 / 癸巳月 / 己酉日 / 癸酉时` |
| Brief 覆盖 6 爻 | `orbit divination brief` 有 6 行 `- 第 N 爻 ...` |
| LLM #1 细化提问类型 | `--debug` 时间线有 `Refined question type: 求事业` 或类似 |
| LLM #1 焦点用神合理 | 时间线有 `Focus 用神: 官鬼`（本场景） |
| RAG 召回有命中 | 时间线有 `deduped=N` 且 N > 0 |
| 召回条目带 source | `Deduped top-k` 行带 `docs/base_knowledge/*.md` |
| 报告含 `[cite: ...]` 标签 | LLM #2 最终回答至少 1 处 `[cite:` |
| LLM #2 命中 prompt cache | `cacheHit > 0`（system prompt 是稳定的） |

如果哪一项没通过：
- **模型不对**：`~/.orbit/config.json` 里可能还是
  `defaultProvider: zhipu`；CLI 会透传它，除非显式 `--model` 覆
  盖。删掉这个文件或者每次传 `--model deepseek-v4-flash`。
- **RAG deduped = 0**：embedder 大概率是默认 hash。设
  `ORBIT_EMBEDDER=remote-zhipu` 然后重启 server。hash embedder 不
  依赖外部 API，但召回质量差。
- **`cacheHit = 0`**：有什么东西在每次调用之间变了 system prompt
  （比如时间戳）。检查 `prompts/system/liuyao-agent.yaml` 有没有
  非静态内容。

---

## Status

**排盘第一段**：完成。确定性引擎对任意 64 卦都能产出完整装饰的
排盘（bits 或 yaoValues 输入，dayStem / dayBranch 可选可省）；
第一段数据无 `warnings[]`。dayStem / dayBranch / monthBranch /
hourBranch / xunkong 都由 caller 的 `datetime`（或"现在"）经
[lunar-typescript](https://www.npmjs.com/package/lunar-typescript) 日
历 skill 推导；时间块 + 旬空注入到 agent 的 system prompt，让 LLM
能基于真实起卦时间推理旺衰、冲合、动爻回头生克。

**RAG**：系统语料（`docs/base_knowledge/*.md`）每次 server 启动都
会自动 bootstrap（见 [src/app.ts](src/app.ts)），用 **contentHash
缓存** —— 文件正文未变就不重做 embed。默认 embedder 是 **智谱
Embedding-3**（2048d，OpenAI 兼容端点 `open.bigmodel.cn/api/paas/v4`，
0.5 元 / Mtok）。用 `ORBIT_EMBEDDER=hash` 可切到无依赖的本地 dev
模式。

**Agent 层**：自带的 `default` agent 跑完整 3 阶段分析流水线
（build brief → LLM #1 理解 → RAG 召回 → LLM #2 综合分析），产出
带 RAG 引用的 6 / 9 段报告。LLM 被约束不得重算任何排盘字段，只能
解读 ChartResult 中已有的内容。

**P2 工作**（仍然 TODO，会作为 `warnings[]` 出现在 chart 响应里）：
完整的冲 / 合 / 刑 / 害 / 破 规则、完整的用神候选规则、定量旺衰
打分、伏神 / 飞神、化进 / 化退。

排盘流水线每一阶段的数据来源（外部表 vs. 内联计算）跟踪在
`docs/liuyao/KNOWLEDGE_NEEDED.md`（P0 = 64 卦表，✅）。

---

## 术语表

README 保留规范的中文术语不翻译，因为它们和代码、CLI flag、system
prompt、dev token 里用的标识符完全一致。LLM 的分析输出也用中文
（agent system prompt 和知识库都是中文）。下表把英文描述映射到
代码库里会出现的规范术语：

| 中文 | English | 备注 |
|---|---|---|
| 本卦 | original hexagram | 起出来的卦 |
| 变卦 | changed hexagram | 动爻翻转后得到的卦 |
| 纳甲 | stem-branch assignment | 标准的装纳甲映射，把干支挂到爻上 |
| 六亲 | six relatives | 父母 / 兄弟 / 子孙 / 妻财 / 官鬼 —— 由 palaceElement vs lineElement 推得 |
| 六神 | six gods | 青龙 / 朱雀 / 勾陈 / 螣蛇 / 白虎 / 玄武 —— 由 dayStem 推得 |
| 世爻 / 应爻 | world line / response line | 一卦中两个关键标记 |
| 用神 | target spirit | 答案所系的那个六亲（例如问事业取官鬼） |
| 旬空 | xunkong / void | 12 天的"空亡"窗口 |
| 动爻 | moving line | 爻值 6（老阴）或 9（老阳）—— 在变卦中翻转 |
| 旺衰 | strong / weak | 一爻的季节性强弱（旺 / 相 / 休 / 囚 / 死） |
| 冲合 | clash / combine | 爻位与爻位 / 爻位与日辰的关系（六冲、六合、三合 等） |
| 回头生 / 克 | reciprocating 生 / 克 | 动爻翻转后的爻对原爻的生克 |
| 父母 / 兄弟 / 子孙 / 妻财 / 官鬼 | parent / sibling / child / wife-wealth / official-ghost | 五个六亲类目 |
| 甲 / 乙 / 丙 / 丁 / ... | the 10 Heavenly Stems | dayStem / monthStem / yearStem / hourStem |
| 子 / 丑 / 寅 / ... | the 12 Earthly Branches | dayBranch / monthBranch / yearBranch / hourBranch |
| 64 卦 / 八宫 | 64 hexagrams / 8 palaces | 全部 64 卦按父母卦分组 |

---

## License

MIT.
