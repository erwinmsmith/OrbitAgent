# OrbitAgent

Modular conversation AI agent backend service with multi-user LLM support.

## Features

- **Multi-LLM Support**: 10+ providers, 25+ models (Claude, GPT, Gemini, DeepSeek, Ollama, Kimi, SiliconFlow, Groq, etc.)
- **Memory Management**: Temporary memory (Redis, 50-pair limit) + Permanent memory (MongoDB)
- **Skill System**: Pluggable skill architecture with trigger-based execution
- **Tool/MCP Integration**: Local and remote MCP server support
- **Workflow Engine**: YAML-based workflow definition and execution
- **Prompt Management**: Template-based prompt system with variable substitution
- **JWT + API Key Authentication**: Dual authentication system with email or phone login
- **Token Usage Tracking**: Automatic token counting and cost calculation per model (USD)
- **User Management**: Profiles, check-in streaks, ritual task history, shared feed
- **RESTful API**: Clean API interface for Swift/Web frontends
- **API Documentation**: Interactive API docs page with search and examples

---

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB
- Redis

Local development can use local MongoDB/Redis services. Production can use
managed services by filling connection-string environment variables. If those
cloud variables are empty or unset, the application automatically falls back to
the local host/port settings.

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```bash
# Leave these empty for local MongoDB/Redis.
MONGODB_URI=
REDIS_URL=

# LLM API Keys (fill in at least one)
ANTHROPIC_API_KEY=sk-ant-xxxxx
OPENAI_API_KEY=sk-xxxxx
SILICONFLOW_API_KEY=sk-xxxxx

# Auth (change in production!)
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret
```

### 3. Start Infrastructure

```bash
# Start Redis
brew services start redis

# Start MongoDB
brew services start mongodb-community
```

### 4. Start the Server

```bash
# Development mode
npm run dev

# Or build and run
npm run build
npm start
```

Server runs at: `http://localhost:3000`

---

## Cloud Database and Deployment

The framework supports local services and managed cloud services with the same
runtime code. Connection-string variables are optional overrides:

- MongoDB: set `MONGODB_URI` to a full MongoDB connection string, such as a
  MongoDB Atlas URI. If `MONGODB_URI` is empty or unset, the app builds a local
  URI from
  `MONGODB_HOST`, `MONGODB_PORT`, `MONGODB_DATABASE`, `MONGODB_USERNAME`, and
  `MONGODB_PASSWORD`.
- Redis: set `REDIS_URL`, `KV_URL`, or `RENDER_REDIS_URL` to a managed Redis or
  Render Key Value connection string. If all three are empty or unset, the app
  connects with `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, and `REDIS_DB`.
- TLS: `rediss://` URLs enable TLS automatically. You can also set
  `REDIS_TLS=true` for providers that require TLS with a `redis://` URL.

This means the same `.env` file can support both modes:

```env
# Local mode
MONGODB_URI=
REDIS_URL=
MONGODB_HOST=localhost
MONGODB_PORT=27017
MONGODB_DATABASE=orbit_agent
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# Cloud mode
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<database>?retryWrites=true&w=majority
REDIS_URL=redis://<render-keyvalue-name>:6379
```

The repository includes a generic `render.yaml` blueprint with:

- one Node web service for the API
- one Render Key Value instance for temporary memory
- generated JWT secrets
- secret placeholders for `MONGODB_URI` and provider API keys

For a Render + MongoDB Atlas deployment:

1. Create or connect a MongoDB Atlas cluster.
2. Add the Render outbound source to the Atlas IP access list. For temporary
   testing, `0.0.0.0/0` is the simplest option; for production, restrict this
   to the Render outbound range or a static outbound IP.
3. Create the Render service from `render.yaml`.
4. Fill `MONGODB_URI` and at least one LLM provider key in Render environment
   variables.
5. Use the Render Key Value internal connection string for `REDIS_URL` when the
   API and Key Value service run in the same Render region.

Minimal production variables:

```env
NODE_ENV=production
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<database>?retryWrites=true&w=majority
REDIS_URL=redis://<render-keyvalue-name>:6379
JWT_SECRET=<generated-or-manual-secret>
JWT_REFRESH_SECRET=<generated-or-manual-secret>
DEEPSEEK_API_KEY=<provider-key>
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

---

## Usage Examples

### 1. Register User

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "username": "myuser",
    "password": "password123"
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "user": { "email": "user@example.com", ... },
    "accessToken": "eyJhbG...",
    "refreshToken": "eyJhbG..."
  }
}
```

### 2. Send Chat Message

```bash
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "message": "你好，请介绍一下自己",
    "model": "Qwen/Qwen3-32B"
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "sessionId": "sess_abc123...",
    "content": "你好！我是 Qwen3...",
    "model": "Qwen/Qwen3-32B",
    "provider": "siliconflow"
  }
}
```

### 3. Get Chat History

```bash
curl http://localhost:3000/api/v1/chat/<sessionId> \
  -H "Authorization: Bearer <your-token>"
```

### 4. List Available Models

```bash
curl http://localhost:3000/api/v1/models \
  -H "Authorization: Bearer <your-token>"
```

### 5. Register with Phone

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "13800138000",
    "username": "myuser",
    "password": "password123"
  }'
```

### 6. Check Token Usage

### 7. Check-in & Get User Profile

```bash
# Get profile (streak, badges)
curl http://localhost:3000/api/v1/users/profile \
  -H "Authorization: Bearer <token>"

# Daily check-in
curl -X POST http://localhost:3000/api/v1/users/profile/check-in \
  -H "Authorization: Bearer <token>"

# User stats (rituals count, likes, streak)
curl http://localhost:3000/api/v1/users/profile/stats \
  -H "Authorization: Bearer <token>"
```

### 8. Ritual Tasks

```bash
# List user's ritual tasks
curl "http://localhost:3000/api/v1/users/tasks?page=1&limit=10" \
  -H "Authorization: Bearer <token>"

# Get public feed (no auth)
curl "http://localhost:3000/api/v1/users/tasks/feed?page=1&limit=20"

# Create a ritual task
curl -X POST http://localhost:3000/api/v1/users/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "triggerSymbol": "山",
    "mode": "decision",
    "question": "我该做出什么决定？"
  }'

# Like a task
curl -X POST http://localhost:3000/api/v1/users/tasks/<taskId>/like \
  -H "Authorization: Bearer <token>"
```

### 9. View API Documentation

```bash
curl http://localhost:3000/api/v1/usage/stats \
  -H "Authorization: Bearer <your-token>"
```

Response:
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalPromptTokens": 50000,
      "totalCompletionTokens": 120000,
      "totalTokens": 170000,
      "totalCost": 2.45,
      "requestCount": 250
    },
    "byModel": [...],
    "daily": [...]
  }
}
```

### 6. View API Documentation

Open in browser:
- API Docs: http://localhost:3000/api/v1/docs
- Status Page: http://localhost:3000/api/v1/status/page
- Usage Dashboard: http://localhost:3000/api/v1/usage/page

---

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Register new user (email or phone) |
| POST | `/api/v1/auth/login` | Login with email or phone |
| POST | `/api/v1/auth/refresh` | Refresh token |
| GET | `/api/v1/auth/me` | Get current user |
| PUT | `/api/v1/auth/me` | Update current user profile |
| POST | `/api/v1/auth/api-key` | Generate API key |
| GET | `/api/v1/auth/api-keys` | List API keys |
| DELETE | `/api/v1/auth/api-key/:keyId` | Revoke API key |
| POST | `/api/v1/auth/logout` | Logout |

### Users (JWT required)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/users/profile` | Get user profile (streak, badges) |
| PUT | `/api/v1/users/profile` | Update profile fields |
| POST | `/api/v1/users/profile/check-in` | Daily check-in |
| GET | `/api/v1/users/profile/stats` | User stats (rituals, likes, streak) |
| GET | `/api/v1/users/profile/token-stats` | Token usage breakdown by model & daily |
| GET | `/api/v1/users/profile/token-usage/recent` | Recent token usage records |
| POST | `/api/v1/users/tasks` | Create a ritual conversation task |
| GET | `/api/v1/users/tasks` | List user's ritual tasks (paginated) |
| GET | `/api/v1/users/tasks/feed` | Public shared ritual feed |
| GET | `/api/v1/users/tasks/:taskId` | Get a single task |
| PUT | `/api/v1/users/tasks/:taskId` | Update task (response, archive, share) |
| POST | `/api/v1/users/tasks/:taskId/like` | Like a task |
| POST | `/api/v1/users/tasks/:taskId/archive` | Archive a task |
| DELETE | `/api/v1/users/tasks/:taskId` | Delete a task |

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/chat` | Send message |
| POST | `/api/v1/chat/stream` | Stream response |
| GET | `/api/v1/chat/:sessionId` | Get history |
| POST | `/api/v1/chat/:sessionId/clear` | Clear session |

### Memory
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/memory/permanent` | List conversations |
| POST | `/api/v1/memory/permanent` | Create conversation |
| GET | `/api/v1/memory/permanent/:id` | Get conversation |
| DELETE | `/api/v1/memory/permanent/:id` | Delete conversation |

### Models
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/models` | List all models |
| GET | `/api/v1/models/:id` | Get model info |
| POST | `/api/v1/models/switch` | Switch default model |

### Token Usage
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/usage/stats` | Get usage stats (total, by model, daily) |
| GET | `/api/v1/usage/recent` | Get recent usage records |
| GET | `/api/v1/usage/conversation/:id` | Get usage for a conversation |
| GET | `/api/v1/usage/pricing` | Get model pricing reference |
| GET | `/api/v1/usage/page` | Token usage HTML dashboard |

### Documentation & Status
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/docs` | Interactive API documentation page |
| GET | `/api/v1/status/page` | Status dashboard (HTML) |
| GET | `/api/v1/health` | Health check |

---

## Configuration

### config.yaml

Main configuration file. Key sections:

```yaml
# App settings
app:
  port: 3000
  apiPrefix: "/api/v1"

# LLM Providers
llm:
  defaultProvider: "siliconflow"
  defaultModel: "Qwen/Qwen3-32B"

# Compatible models (OpenAI API format)
compatible:
  siliconflow:
    enabled: true
    baseUrl: "https://api.siliconflow.cn/v1"
    models:
      - id: "Qwen/Qwen3-32B"
        name: "Qwen3-32B"
        enabled: true
        default: true
```

### Available Providers

| Provider | Environment Variable | Models |
|----------|---------------------|--------|
| Anthropic Claude | `ANTHROPIC_API_KEY` | claude-3-5-sonnet, claude-3-opus, etc. |
| OpenAI | `OPENAI_API_KEY` | gpt-4o, gpt-4-turbo, gpt-3.5-turbo |
| Google Gemini | `GOOGLE_API_KEY` | gemini-2.0-flash, gemini-1.5-pro |
| DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat, deepseek-coder |
| Ollama | (local) | llama2, llama3, mistral, codellama |
| Kimi (Moonshot) | `KIMI_API_KEY` | moonshot-v1-8k, moonshot-v1-128k |
| SiliconFlow | `SILICONFLOW_API_KEY` | Qwen3-32B, Qwen2.5-7B, GLM-4 |
| Groq | `GROQ_API_KEY` | llama-3.1-70b, mixtral-8x7b |
| Together AI | `TOGETHER_API_KEY` | Llama-3-70B, DeepSeek-V2 |
| Perplexity | `PERPLEXITY_API_KEY` | sonar-large-online |

### Token Pricing

Token usage is automatically tracked on every chat request. Costs are calculated in USD:

| Provider | Model | Input ($/M tokens) | Output ($/M tokens) |
|----------|-------|---------------------|---------------------|
| Anthropic | Claude 3.5 Sonnet | $3.00 | $15.00 |
| Anthropic | Claude 3.5 Haiku | $0.80 | $4.00 |
| OpenAI | GPT-4o | $2.50 | $10.00 |
| OpenAI | GPT-4 Turbo | $10.00 | $30.00 |
| OpenAI | GPT-3.5 Turbo | $0.50 | $1.50 |
| Google | Gemini 2.0 Flash | $0.00 | $0.10 |
| Google | Gemini 1.5 Pro | $1.25 | $5.00 |
| DeepSeek | deepseek-chat | $0.27 | $1.10 |
| Ollama | (local models) | $0.00 | $0.00 |

View all pricing: `GET /api/v1/usage/pricing`

---

## Project Structure

```
orbit-agent/
├── src/
│   ├── core/
│   │   ├── llm/           # LLM adapters
│   │   ├── memory/         # Memory systems
│   │   ├── skills/         # Skill system
│   │   ├── tools/          # Tool/MCP
│   │   └── workflow/       # Workflow engine
│   ├── prompts/             # Prompt templates
│   ├── routes/              # API routes
│   │   ├── api-docs.routes.ts    # API documentation
│   │   ├── chat.routes.ts        # Chat endpoints
│   │   ├── memory.routes.ts      # Memory endpoints
│   │   ├── usage.routes.ts       # Token usage endpoints
│   │   └── ...
│   ├── models/              # MongoDB models
│   │   ├── TokenUsage.ts    # Token usage tracking
│   │   └── ...
│   ├── services/            # Business services
│   │   └── TokenService.ts  # Token tracking service
│   ├── config/              # Configuration
│   ├── middleware/          # Express middleware
│   └── app.ts               # Entry point
├── configs/                 # YAML configs
├── prompts/                 # Prompt templates
├── tests/                   # Tests
├── config.yaml              # Main config
├── .env                     # Environment variables
└── package.json
```

---

## Skills

Skills are pre/post-processing hooks that run in priority order on every
chat turn. They can inject variables into the LLM context, rewrite the
user message, or halt the pipeline.

### File format: `.md` (Anthropic-style)

Each skill is a single Markdown file with YAML frontmatter:

```markdown
---
id: timezone-greeter
name: Timezone Greeter
description: Stamps the current ISO time on context.variables
version: 1.0.0
priority: 3                    # higher runs first
enabled: true
triggers:
  - type: always             # or keyword / regex / intent
    pattern: ""               # keyword / regex body, or intent name
---

# Timezone Greeter

The body is human-readable documentation. It is exposed on
`GET /api/v1/skills/:id` (under `body`) and is intended to be passed
to the LLM as a system message if you want the model to "know" the
skill's purpose.
```

Required frontmatter fields: `id`, `name`, `description`, `version`,
`priority`, `triggers` (at least one). `enabled` defaults to `true`.

### Where skills live

| Location | Purpose | Writable |
|---|---|---|
| `src/core/skills/builtins/*.md` | Bundled with the source tree (read-only at runtime) | no |
| `~/.orbit/skills/*.md` | User-installed via CLI / HTTP API | yes |

Scanned in that order on every `SkillManager.initialize()` (which the
chat route calls via `POST /skills/reload` after an install/uninstall).
A user-skill with the same id as a built-in overrides the built-in.

### Adding a built-in

1. Create `src/core/skills/builtins/your-skill.md` with valid frontmatter.
2. If your skill needs to mutate the context (not just document itself),
   add an entry in `BUILTIN_HANDLERS` inside
   [src/core/skills/SkillManager.ts](src/core/skills/SkillManager.ts).
3. Rebuild. The skill is live after the next server restart.

### Install / uninstall via the CLI

```bash
orbit skill install ./my-skill.md          # local file
orbit skill install https://example.com/skill.md   # http(s) URL
orbit skill install --inline "$(cat ./skill.md)"    # raw text

orbit skill show timezone-greeter         # dump the .md
orbit skill installed                    # list user installs
orbit skill reload                       # re-scan after manual file edits
orbit skill uninstall timezone-greeter   # admin-only
```

### Install / uninstall via HTTP

```bash
# Install from a URL
curl -X POST $API/skills/install -H "$H" -H "Content-Type: application/json" \
  -d '{"source":"url","url":"https://example.com/skill.md"}'

# Install from raw text
curl -X POST $API/skills/install -H "$H" -H "Content-Type: application/json" \
  -d "$(jq -n --arg body "$(cat my-skill.md)" '{source:"inline",content:$body,filename:"my-skill.md"}')"

# Reload after manual edits
curl -X POST $API/skills/reload -H "$H"

# Uninstall (admin)
curl -X DELETE $API/skills/install/<id> -H "$H"
```

---

## CLI (`orbit`)

After `npm run build && npm link`, the `orbit` command is available on your PATH. The CLI is a **thin client over the existing backend REST API** — it does not re-implement any business logic, it just calls the same `/api/v1/*` endpoints the web UI / mobile app use.

### Install

```bash
npm install         # installs commander + chalk
npm run build       # compiles src/cli → dist/cli/index.js (auto chmod +x)
npm link            # registers the `orbit` shim on your PATH
```

### Start the backend first

The CLI is a client only — the backend must be running:

```bash
# terminal A
npm run dev
```

### Basic flow

```bash
# terminal B
orbit login --dev                 # get a 30-day dev JWT, stored in ~/.orbit/token.json
orbit whoami                      # dev@test.local

orbit chat "hello"                # single turn
orbit chat --stream "hello"       # SSE streaming
orbit chat --session sess_abc "my name is erwin"
orbit chat --session sess_abc "what's my name?"  # multi-turn (Redis history auto-injected)

orbit history sess_abc --limit 5
```

### Command reference

| Command | Backend endpoint | Description |
|---|---|---|
| `orbit` | — | Print base URL, home dir, and login state |
| `orbit login [--dev] [--email E --password P]` | `POST /auth/login` or `POST /dev/token` | Persist a JWT; `--dev` skips the password |
| `orbit logout` | — | Delete the stored token |
| `orbit whoami` | — | Show the current login |
| `orbit chat [msg...]` | `POST /chat` | Single turn; supports `--stream` `--session ID` `-m/--model` `-p/--provider` `--system TEXT`; reads stdin if no arg given |
| `orbit history <sessionId> [-l N]` | `GET /chat/:sessionId` | Pull temporary chat history |
| `orbit models [-p provider] [--ids]` | `GET /models` | Group by provider; `--ids` prints one ID per line for piping |
| `orbit health` | `GET /models/health` | LLM provider health table |
| `orbit switch <provider> <model>` | `POST /models/switch` | Change server default; also writes to local config |
| `orbit defaults` | `GET /models/defaults/current` | Show server default |
| `orbit skills` | `GET /skills` | Loaded skills |
| `orbit tools` | `GET /tools` | Tools + JSON schema |
| `orbit exec <name> -p <json>` | `POST /tools/execute` | Run a tool; e.g. `orbit exec filesystem -p '{"operation":"list","path":"."}'` |
| `orbit workflows` | `GET /workflows` | List workflows |
| `orbit workflow-run <name> [-v V] -c <json>` | `POST /workflows/:name/execute` | Execute a workflow |
| `orbit usage` | `GET /usage/stats` | summary + byModel + daily |
| `orbit pricing` | `GET /usage/pricing` | Pricing reference (includes `cacheHitPricePerM`) |
| `orbit config show` | — | Print the current effective config |
| `orbit config set-base <url>` | — | Change the backend URL (e.g. point at a LAN machine) |
| `orbit config set-model <provider> <model>` | — | Persist a default model so you don't pass `-m` every time |

### State files (`~/.orbit/`)

| File | Contents | Permissions |
|---|---|---|
| `config.json` | `baseUrl`, `defaultProvider?`, `defaultModel?` | 0644 |
| `token.json` | `{token, userId, email, isAdmin, savedAt}` | 0600 |

### Environment variable overrides

```bash
ORBIT_HOME=/custom/path orbit login                          # default: ~/.orbit
ORBIT_BASE_URL=http://x.y.z:3000/api/v1 orbit chat "hi"      # one-off backend
ORBIT_MODEL=claude-3-5-sonnet-20241022 ORBIT_PROVIDER=anthropic orbit chat "hi"
```

### Adding a new command

`src/cli/commands/foo.ts`:

```ts
import { Command } from 'commander';
import { apiGet } from '../http';
export function registerFoo(program: Command): void {
  program.command('foo').action(async () => {
    const data = await apiGet<any>('/some/endpoint');
    console.log(data);
  });
}
```

Then import it at the top of [src/cli/index.ts](src/cli/index.ts) and call `registerFoo(program)` at the bottom. Build with `npm run build` and the new command is live.

---

## Scripts

```bash
npm run dev          # Development mode
npm run build        # Build for production (also builds the orbit CLI)
npm start            # Run production server
npm test             # Run tests
npm run typecheck    # TypeScript check
npm run cli          # Run the CLI in dev mode via ts-node (no build needed)
```

---

## License

MIT
