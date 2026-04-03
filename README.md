# OrbitAgent

Modular conversation AI agent backend service with multi-user LLM support.

## Features

- **Multi-LLM Support**: 10+ providers, 25+ models (Claude, GPT, Gemini, DeepSeek, Ollama, Kimi, SiliconFlow, Groq, etc.)
- **Memory Management**: Temporary memory (Redis, 50-pair limit) + Permanent memory (MongoDB)
- **Skill System**: Pluggable skill architecture with trigger-based execution
- **Tool/MCP Integration**: Local and remote MCP server support
- **Workflow Engine**: YAML-based workflow definition and execution
- **Prompt Management**: Template-based prompt system with variable substitution
- **JWT + API Key Authentication**: Dual authentication system
- **Token Usage Tracking**: Automatic token counting and cost calculation per model (USD)
- **RESTful API**: Clean API interface for Swift/Web frontends
- **API Documentation**: Interactive API docs page with search and examples

---

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB
- Redis

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

### 5. Check Token Usage

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
| POST | `/api/v1/auth/register` | Register new user |
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/refresh` | Refresh token |
| GET | `/api/v1/auth/me` | Get current user |
| POST | `/api/v1/auth/api-key` | Generate API key |

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

## Scripts

```bash
npm run dev          # Development mode
npm run build        # Build for production
npm start            # Run production server
npm test             # Run tests
npm run typecheck    # TypeScript check
```

---

## License

MIT
