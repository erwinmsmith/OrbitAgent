import { useCallback, useMemo, useRef, useState } from 'react'
import { useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from '@assistant-ui/react'
import { streamChat, type ApiMessage } from '../lib/api'

type AssistantMessageStatus = NonNullable<ThreadMessageLike['status']>

export interface OrbitUiMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: Date
  status?: AssistantMessageStatus
}

interface UseOrbitRuntimeOptions {
  token: string
  sessionId: string
  isSendDisabled?: boolean
  onSessionResolved: (sessionId: string) => void
  onConversationChanged: () => void
}

const createId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`

function textFromAppendMessage(message: AppendMessage): string {
  return message.content
    .map((part) => {
      if (part.type === 'text') return part.text
      return ''
    })
    .join('')
    .trim()
}

export function fromApiMessages(messages: ApiMessage[]): OrbitUiMessage[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'system')
    .map((message, index) => ({
      id: message.id ?? `${message.role}_${index}`,
      role: message.role as OrbitUiMessage['role'],
      content: message.content,
      createdAt: message.timestamp ? new Date(message.timestamp) : new Date(),
      status:
        message.role === 'assistant'
          ? {
              type: 'complete' as const,
              reason: 'stop' as const,
            }
          : undefined,
    }))
}

export function useOrbitAssistantRuntime({
  token,
  sessionId,
  isSendDisabled,
  onSessionResolved,
  onConversationChanged,
}: UseOrbitRuntimeOptions) {
  const [messages, setMessages] = useState<OrbitUiMessage[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = textFromAppendMessage(message)
      if (!text || isRunning) return

      const userMessage: OrbitUiMessage = {
        id: createId('user'),
        role: 'user',
        content: text,
        createdAt: new Date(),
      }
      const assistantId = createId('assistant')
      const assistantMessage: OrbitUiMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: new Date(),
        status: { type: 'running' },
      }

      setMessages((current) => [...current, userMessage, assistantMessage])
      setIsRunning(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        let finalContent = ''
        for await (const event of streamChat(
          token,
          {
            sessionId,
            message: text,
            agentId: 'default',
          },
          controller.signal,
        )) {
          if (event.type === 'content' && event.content) {
            finalContent += event.content
            setMessages((current) =>
              current.map((item) =>
                item.id === assistantId
                  ? {
                      ...item,
                      content: finalContent,
                      status: { type: 'running' },
                    }
                  : item,
              ),
            )
          }

          if (event.type === 'done') {
            if (event.sessionId) onSessionResolved(event.sessionId)
            setMessages((current) =>
              current.map((item) =>
                item.id === assistantId
                  ? {
                      ...item,
                      content: event.content ?? finalContent,
                      status: { type: 'complete', reason: 'stop' },
                    }
                  : item,
              ),
            )
          }

          if (event.type === 'error') {
            throw new Error(event.error ?? 'Assistant stream failed')
          }
        }
        onConversationChanged()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Assistant stream failed'
        setMessages((current) =>
          current.map((item) =>
            item.id === assistantId
              ? {
                  ...item,
                  content: item.content || message,
                  status: {
                    type: 'incomplete',
                    reason: controller.signal.aborted ? 'cancelled' : 'error',
                    error: message,
                  },
                }
              : item,
          ),
        )
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setIsRunning(false)
      }
    },
    [isRunning, onConversationChanged, onSessionResolved, sessionId, token],
  )

  const runtime = useExternalStoreRuntime({
    messages,
    setMessages: (nextMessages) => setMessages([...nextMessages]),
    isRunning,
    isSendDisabled,
    onNew,
    onCancel: async () => {
      abortRef.current?.abort()
    },
    convertMessage: (message: OrbitUiMessage) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      status: message.role === 'assistant' ? message.status : undefined,
    }),
  })

  return useMemo(
    () => ({
      runtime,
      messages,
      setMessages,
      isRunning,
    }),
    [isRunning, messages, runtime],
  )
}
