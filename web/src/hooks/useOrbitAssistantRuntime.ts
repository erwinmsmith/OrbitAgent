import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const EMPTY_MESSAGES: OrbitUiMessage[] = []

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
  const [messagesBySession, setMessagesBySession] = useState<Record<string, OrbitUiMessage[]>>({})
  const [runningSessions, setRunningSessions] = useState<Record<string, boolean>>({})
  const runningRef = useRef<Record<string, boolean>>({})
  const abortsRef = useRef<Record<string, AbortController>>({})
  const activeSessionRef = useRef(sessionId)

  useEffect(() => {
    activeSessionRef.current = sessionId
  }, [sessionId])

  const setSessionMessages = useCallback((
    targetSessionId: string,
    next:
      | OrbitUiMessage[]
      | ((current: OrbitUiMessage[]) => OrbitUiMessage[]),
  ) => {
    setMessagesBySession((current) => {
      const currentMessages = current[targetSessionId] ?? []
      const nextMessages = typeof next === 'function' ? next(currentMessages) : next
      return {
        ...current,
        [targetSessionId]: [...nextMessages],
      }
    })
  }, [])

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = textFromAppendMessage(message)
      const requestSessionId = sessionId
      if (!text || runningRef.current[requestSessionId]) return
      runningRef.current = { ...runningRef.current, [requestSessionId]: true }
      setRunningSessions((current) => ({ ...current, [requestSessionId]: true }))

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

      setSessionMessages(requestSessionId, (current) => [...current, userMessage, assistantMessage])

      const controller = new AbortController()
      abortsRef.current = { ...abortsRef.current, [requestSessionId]: controller }

      try {
        let finalContent = ''
        for await (const event of streamChat(
          token,
          {
            sessionId: requestSessionId,
            message: text,
            agentId: 'default',
          },
          controller.signal,
        )) {
          if (event.type === 'content' && event.content) {
            finalContent += event.content
            setSessionMessages(requestSessionId, (current) =>
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
            if (event.sessionId && activeSessionRef.current === requestSessionId) {
              onSessionResolved(event.sessionId)
            }
            setSessionMessages(requestSessionId, (current) =>
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
        setSessionMessages(requestSessionId, (current) =>
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
        const nextAborts = { ...abortsRef.current }
        delete nextAborts[requestSessionId]
        abortsRef.current = nextAborts
        const nextRunningRef = { ...runningRef.current }
        delete nextRunningRef[requestSessionId]
        runningRef.current = nextRunningRef
        setRunningSessions((current) => {
          const next = { ...current }
          delete next[requestSessionId]
          return next
        })
      }
    },
    [onConversationChanged, onSessionResolved, sessionId, setSessionMessages, token],
  )

  const messages = messagesBySession[sessionId] ?? EMPTY_MESSAGES
  const isRunning = !!runningSessions[sessionId]

  const runtime = useExternalStoreRuntime({
    messages,
    setMessages: (nextMessages) => setSessionMessages(sessionId, [...nextMessages]),
    isRunning,
    isSendDisabled,
    onNew,
    onCancel: async () => {
      abortsRef.current[sessionId]?.abort()
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
      setMessages: (next: OrbitUiMessage[] | ((current: OrbitUiMessage[]) => OrbitUiMessage[])) =>
        setSessionMessages(sessionId, next),
      setSessionMessages,
      isRunning,
      runningSessions,
    }),
    [isRunning, messages, runtime, runningSessions, sessionId, setSessionMessages],
  )
}
