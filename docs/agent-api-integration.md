# OrbitAgent 六爻 Agent API Integration

本文档面向需要把 OrbitAgent 六爻 Agent 接入到 Web、移动端、机器人或第三方后端的开发者。

默认 API 前缀：

```text
http://127.0.0.1:3000/api/v1
```

生产环境请替换为部署后的 API 域名。

## 认证

所有业务接口都需要认证。推荐使用长期邀请码登录。

### 邀请码登录

```http
POST /auth/invite
Content-Type: application/json
```

请求：

```json
{
  "code": "ORB-XXXX-XXXX-XXXX"
}
```

响应：

```json
{
  "success": true,
  "data": {
    "user": { "id": "...", "email": "...", "username": "..." },
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

后续请求带上：

```http
Authorization: Bearer <accessToken>
```

### 刷新 Token

```http
POST /auth/refresh
Content-Type: application/json
```

```json
{
  "refreshToken": "<refreshToken>"
}
```

## 推荐集成方式

最推荐使用已经封装好的高层接口，而不是自行串联每个底层步骤。

### 1. 一次完成起卦、排盘、解读

```http
POST /divination/ask
Authorization: Bearer <accessToken>
Content-Type: application/json
```

请求示例：

```json
{
  "sessionId": "sess_demo_001",
  "question": "我近期求财是否顺利？",
  "message": "请结合卦象分析、解答问题",
  "method": "manual",
  "yaoValues": [8, 7, 7, 7, 7, 7],
  "timezone": "Asia/Shanghai",
  "debug": false
}
```

常用起卦输入：

```json
{ "method": "manual", "yaoValues": [7, 8, 9, 6, 7, 8] }
```

```json
{ "method": "manual", "bits": [1, 0, 1, 0, 1, 0] }
```

```json
{ "method": "coins", "coins": [["正", "反", "反"], ["正", "正", "正"], ["正", "反", "反"], ["正", "反", "反"], ["反", "反", "反"], ["正", "反", "反"]] }
```

```json
{ "method": "numbers", "numbers": [2, 9, 5] }
```

```json
{ "method": "character", "character": "财" }
```

响应重点字段：

```json
{
  "success": true,
  "data": {
    "sessionId": "sess_demo_001",
    "chartKey": "default",
    "content": "完整解读 Markdown",
    "chart": {
      "originalHexagram": {},
      "changedHexagram": {},
      "movingLines": [],
      "lines": [],
      "hiddenGods": []
    },
    "report": {},
    "brief": {}
  }
}
```

说明：

- `content` 是完整解读文本。
- `chart` 是排盘结构，可用于前端画卦图、六爻表、飞神伏神。
- `brief` 是给模型使用的结构化摘要，也适合调试。
- `sessionId` 后续用于多轮追问。

### 2. 生成适合聊天窗口展示的短答

`/divination/ask` 返回的是完整解读。若前端希望先展示短 summary，再用按钮展开详情，使用：

```http
POST /divination/summarize/stream
Authorization: Bearer <accessToken>
Content-Type: application/json
Accept: text/event-stream
```

请求：

```json
{
  "sessionId": "sess_demo_001",
  "question": "我近期求财是否顺利？",
  "chart": {},
  "content": "上一接口返回的完整解读 Markdown"
}
```

SSE 事件格式：

```text
data: {"type":"content","content":"结论：..."}

data: {"type":"done","content":"完整短答","usage":{...}}
```

### 3. 后续多轮追问

起卦完成后，继续使用同一个 `sessionId`：

```http
POST /chat/stream
Authorization: Bearer <accessToken>
Content-Type: application/json
Accept: text/event-stream
```

请求：

```json
{
  "sessionId": "sess_demo_001",
  "agentId": "liuyao",
  "message": "这个伏神对判断有什么影响？"
}
```

SSE 响应：

```text
data: {"type":"content","content":"..."}

data: {"type":"done","content":"完整回复","sessionId":"sess_demo_001","model":"...","provider":"..."}
```

## 底层拆分接口

如果你需要自定义流程，可以使用以下接口逐步组合。

### 起卦归一化

```http
POST /divination/cast
```

输入 coins、numbers、character、bits 或 yaoValues，返回标准 `yaoValues` 和 casting meta。

### 只排盘并保存

```http
POST /divination/chart
```

请求必须包含 `sessionId`，以及 `bits` 或 `yaoValues` / structured casting 输入。返回完整 `chart`，并保存到服务端 ChartStore。

### 只分析已保存或传入的排盘

```http
POST /divination/analyze
```

读取已保存排盘：

```json
{
  "sessionId": "sess_demo_001",
  "debug": true
}
```

或直接传入：

```json
{
  "chart": {},
  "debug": true
}
```

### 查看排盘 Brief

```http
GET /divination/brief/:sessionId
```

用于调试模型看到的结构化排盘摘要，不产生 LLM 成本。

### 恢复已有起卦会话

```http
GET /divination/reading/:sessionId
```

用于前端重新进入历史会话时恢复 `chart`、`content`、`report`。

### 会话消息

```http
GET /chat/conversations/:sessionId/messages?page=1&pageSize=100
```

返回适合前端展示的可见消息，已过滤内部完整报告和重复消息。

## RAG 知识库接口

普通用户上传私有文档：

```http
POST /divination/rag/upload
Content-Type: application/json
```

```json
{
  "filename": "my-notes.md",
  "body": "# 我的补充知识..."
}
```

查询知识库：

```http
POST /divination/rag/search
```

```json
{
  "query": "伏神 飞神",
  "k": 5
}
```

查看统计：

```http
GET /divination/rag/list
```

## 输入可理解性约束

Agent 已内置输入可理解性规则：

- 如果用户输入是乱码、随机字符、明显不成句或无法理解的内容，Agent 应要求用户重新输入。
- 该规则适用于 `/divination/ask` 的第一次提问，也适用于 `/chat` / `/chat/stream` 后续追问。
- 此时不应根据卦象强行分析，也不应猜测用户意图。

建议客户端也做基础校验：

- 空字符串不发送。
- 明显只有符号或空格的输入直接提示用户重输。
- 不要在前端替用户补全问题，以免改变占问语义。

## 错误格式

普通 JSON 错误：

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "..."
  }
}
```

SSE 错误：

```text
data: {"type":"error","code":"LLM_ERROR","error":"..."}
```

## 最小前端流程

1. `POST /auth/invite` 登录，保存 `accessToken` 和 `refreshToken`。
2. 用户在起卦工作台输入问题和起卦方式。
3. 调 `POST /divination/ask`，保存返回的 `sessionId`、`chart`、`content`。
4. 调 `POST /divination/summarize/stream`，聊天窗口先展示短答。
5. 把 `chart` 和 `content` 放到“卦象 / 解读详情”按钮卡片里展开。
6. 用户追问时调 `POST /chat/stream`，始终复用同一个 `sessionId`。
7. 用户重新打开历史会话时，调 `GET /divination/reading/:sessionId` 和 `GET /chat/conversations/:sessionId/messages` 恢复状态。
