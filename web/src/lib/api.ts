const DEFAULT_API_BASE = import.meta.env.PROD
  ? 'https://orbit-agent-api.onrender.com/api/v1'
  : '/api/v1'

export const API_BASE =
  import.meta.env.VITE_ORBIT_API_BASE ?? DEFAULT_API_BASE

export interface ApiEnvelope<T> {
  success: boolean
  data: T
  error?: {
    code: string
    message: string
  }
}

export class ApiError extends Error {
  code?: string
  status: number

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface AuthUser {
  _id: string
  email: string
  username: string
  displayName?: string
  isAdmin?: boolean
}

export interface InviteLoginData {
  user: AuthUser
  invite: {
    label: string
    lastUsedAt?: string
  }
  accessToken: string
  refreshToken: string
}

export interface RefreshTokenData {
  accessToken: string
  refreshToken: string
}

export interface ConversationSummary {
  id: string
  userId: string
  sessionId: string
  agentId: string
  modelId: string
  modelProvider: string
  title?: string
  tags?: string[]
  createdAt: string
  updatedAt: string
  isArchived: boolean
}

export interface ApiMessage {
  id: string
  conversationId?: string
  userId?: string
  sessionId?: string
  role: 'system' | 'user' | 'assistant' | 'function'
  content: string
  timestamp?: string
  modelId?: string
  modelProvider?: string
  metadata?: Record<string, unknown>
}

export interface StreamEvent {
  type: 'content' | 'done' | 'error'
  content?: string
  sessionId?: string
  error?: string
  code?: string
}

export type DivinationMethod = 'coins' | 'manual' | 'time' | 'numbers' | 'character'

export interface DivinationAskBody {
  sessionId: string
  question: string
  message: string
  timezone?: string
  datetime?: string
  debug?: boolean
  thinking?: boolean
  angles?: number
  bits?: number[]
  yaoValues?: number[]
  casting?: {
    method: DivinationMethod
    numbers?: number[]
    character?: string
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  const payload = await readJsonEnvelope<T>(res)
  if (!res.ok || !payload.success) {
    throw new ApiError(
      payload.error?.message ?? `Request failed with ${res.status}`,
      res.status,
      payload.error?.code,
    )
  }
  return payload.data
}

async function readJsonEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
  const body = await res.text()
  try {
    return JSON.parse(body) as ApiEnvelope<T>
  } catch {
    const preview = body.trim().replace(/\s+/g, ' ').slice(0, 140)
    throw new ApiError(
      `API returned a non-JSON response (${res.status}). ${preview || res.statusText || 'Empty response'}`,
      res.status,
      'NON_JSON_RESPONSE',
    )
  }
}

export async function inviteLogin(code: string): Promise<InviteLoginData> {
  try {
    const res = await fetch(`${API_BASE}/auth/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    return parseResponse<InviteLoginData>(res)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('无法连接后端服务，请确认 API 服务已启动', { cause: error })
    }
    throw error
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<RefreshTokenData> {
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
  return parseResponse<RefreshTokenData>(res)
}

export async function listConversations(token: string): Promise<ConversationSummary[]> {
  const res = await fetch(`${API_BASE}/chat/conversations?pageSize=50`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse<ConversationSummary[]>(res)
}

export async function loadConversationMessages(token: string, sessionId: string): Promise<ApiMessage[]> {
  const res = await fetch(
    `${API_BASE}/chat/conversations/${encodeURIComponent(sessionId)}/messages?pageSize=200`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return parseResponse<ApiMessage[]>(res)
}

export async function deleteConversation(token: string, sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  await parseResponse<unknown>(res)
}

export async function askDivination(token: string, body: DivinationAskBody): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/divination/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  return parseResponse<Record<string, unknown>>(res)
}

export async function loadDivinationReading(token: string, sessionId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/divination/reading/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse<Record<string, unknown>>(res)
}

export async function rebuildRag(token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/divination/rag/rebuild`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  return parseResponse<Record<string, unknown>>(res)
}

export async function* streamDivinationSummary(
  token: string,
  body: {
    sessionId?: string
    question: string
    chart: unknown
    content: string
    agentId?: string
  },
): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${API_BASE}/divination/summarize/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    await throwStreamError(res, 'Summary stream failed')
  }
  if (!res.body) {
    throw new ApiError('Summary stream failed with empty response', res.status)
  }

  yield* readSseStream(res.body)
}

export async function* streamChat(
  token: string,
  body: {
    sessionId: string
    message: string
    agentId?: string
  },
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    await throwStreamError(res, 'Stream failed')
  }
  if (!res.body) {
    throw new ApiError('Stream failed with empty response', res.status)
  }

  yield* readSseStream(res.body)
}

async function throwStreamError(res: Response, fallback: string): Promise<never> {
  try {
    const payload = await readJsonEnvelope<unknown>(res)
    throw new ApiError(
      payload.error?.message ?? `${fallback} with ${res.status}`,
      res.status,
      payload.error?.code,
    )
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(`${fallback} with ${res.status}`, res.status)
  }
}

async function* readSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      const line = event
        .split('\n')
        .find((item) => item.startsWith('data: '))
      if (!line) continue
      yield JSON.parse(line.slice(6)) as StreamEvent
    }
  }
}
