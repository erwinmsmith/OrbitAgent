import axios, { AxiosInstance } from 'axios';
import { ILLMAdapter, ChatOptions, ChatResponse, LLMMessage, StreamChunk, ToolDefinition, ModelInfo } from '../types';
import { logger } from '../../../utils/logger';

/**
 * Convert our neutral LLMMessage[] to OpenAI/DeepSeek chat-completions
 * message format, including the assistant `tool_calls` field and the
 * `tool` role (used to return a tool's output back to the model).
 *
 * DeepSeek-v4 reasoning mode requires `reasoning_content` from each
 * prior assistant turn to be passed back, or the API returns
 * "reasoning_content in the thinking mode must be passed back to the
 * API". The chat loop stores that field in `providerExtras`; we
 * surface it here as the `reasoning_content` field on the assistant
 * message. (The exact key lives in `providerExtras.reasoningContent`
 * to stay neutral across providers — DeepSeek's on-the-wire key
 * is `reasoning_content`.)
 */
function toOpenAIMessages(messages: LLMMessage[]): any[] {
  return messages.map((msg) => {
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      const out: any = {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
        })),
      };
      // DeepSeek v4 reasoning mode: round-trip reasoning_content
      // from the previous assistant turn. The chat loop stores it
      // under providerExtras; for non-reasoning turns this is just
      // undefined and the field is omitted.
      const rc = msg.providerExtras?.reasoningContent;
      if (typeof rc === 'string' && rc.length > 0) {
        out.reasoning_content = rc;
      }
      return out;
    }
    if (msg.role === 'tool') {
      return { role: 'tool', tool_call_id: msg.toolCallId ?? '', content: msg.content };
    }
    return { role: msg.role, content: msg.content };
  });
}

export class DeepSeekAdapter implements ILLMAdapter {
  readonly name = 'DeepSeekAdapter';
  readonly provider: 'deepseek' = 'deepseek';

  private client: AxiosInstance | null = null;
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  constructor(apiKey: string, baseUrl?: string, timeout?: number) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    this.timeout = timeout || 60000;
  }

  async initialize(): Promise<void> {
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: this.timeout,
    });
    logger.info('DeepSeekAdapter initialized');
  }

  async destroy(): Promise<void> {
    this.client = null;
    logger.info('DeepSeekAdapter destroyed');
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<ChatResponse> {
    if (!this.client) await this.initialize();

    const model = options?.model || 'deepseek-v4-flash';

    const requestMessages = toOpenAIMessages(messages);

    try {
      const response = await this.client!.post('/chat/completions', {
        model,
        messages: requestMessages,
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
        top_p: options?.topP,
        stop: options?.stopSequences,
        stream: false,
        tools: options?.tools?.map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
      });

      const data = response.data;
      const choice = data.choices[0];

      return {
        id: data.id,
        model: data.model,
        provider: this.provider,
        content: choice.message.content || '',
        role: 'assistant',
        finishReason: choice.finish_reason || 'stop',
        usage: data.usage ? {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
          // DeepSeek v4 reports cached prompt tokens in `prompt_tokens_details.cached_tokens`.
          cacheHitTokens: data.usage.prompt_tokens_details?.cached_tokens ?? 0,
        } : undefined,
        toolCalls: choice.message.tool_calls?.map((tc: any) => ({
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        })),
        // DeepSeek v4 reasoning-mode bookkeeping: the model emits
        // `reasoning_content` alongside `content`; we surface it
        // under providerExtras so the chat loop can round-trip it
        // on the next request (see toOpenAIMessages above).
        providerExtras: (() => {
          const rc = choice.message.reasoning_content;
          return typeof rc === 'string' && rc.length > 0
            ? { reasoningContent: rc }
            : undefined;
        })(),
        raw: data,
      };
    } catch (error: any) {
      // Extract a clean message FIRST — winston serializing the raw axios
      // error blows up on its request<->response cycle, and that stringify
      // error would otherwise replace our real message.
      const msg = error?.response?.data?.error?.message
        || error?.response?.data?.message
        || error?.message
        || String(error);
      logger.error(`DeepSeek chat error: ${msg}`);
      throw new Error(`DeepSeek API error: ${msg}`);
    }
  }

  async *streamChat(messages: LLMMessage[], options?: ChatOptions): AsyncGenerator<StreamChunk> {
    if (!this.client) await this.initialize();

    const model = options?.model || 'deepseek-v4-flash';

    const requestMessages = toOpenAIMessages(messages);

    try {
      const response = await this.client!.post('/chat/completions', {
        model,
        messages: requestMessages,
        temperature: options?.temperature,
        max_tokens: options?.maxTokens,
        top_p: options?.topP,
        stop: options?.stopSequences,
        stream: true,
        tools: options?.tools?.map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
      }, {
        responseType: 'stream',
      });

      let fullContent = '';
      let toolCalls: any[] = [];
      let finishReason: string | undefined;

      const stream = response.data;

      for await (const chunk of stream) {
        try {
          const lines = chunk.toString().split('\n').filter((line: string) => line.trim() !== '');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              if (data.choices?.[0]?.delta) {
                const delta = data.choices[0].delta;

                if (delta.content) {
                  fullContent += delta.content;
                  yield { type: 'content', content: delta.content };
                }

                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const existing = toolCalls.find(t => t.id === tc.id);
                    if (existing) {
                      existing.input += tc.function?.arguments || '';
                    } else if (tc.function) {
                      toolCalls.push({
                        id: tc.id,
                        name: tc.function.name,
                        input: tc.function.arguments || '',
                      });
                    }
                  }
                }
              }

              if (data.choices?.[0]?.finish_reason) {
                finishReason = data.choices[0].finish_reason;
              }

              if (data.usage) {
                yield {
                  type: 'done',
                  usage: {
                    inputTokens: data.usage.prompt_tokens,
                    outputTokens: data.usage.completion_tokens,
                    totalTokens: data.usage.total_tokens,
                    cacheHitTokens: data.usage.prompt_tokens_details?.cached_tokens ?? 0,
                  },
                  finishReason,
                };
              }
            }
          }
        } catch (parseError) {
          // Skip malformed JSON lines
        }
      }

      yield { type: 'done', content: fullContent, finishReason };
    } catch (error: any) {
      const msg = error?.response?.data?.error?.message
        || error?.response?.data?.message
        || error?.message
        || String(error);
      logger.error(`DeepSeek stream error: ${msg}`);
      yield { type: 'error', error: msg };
    }
  }

  async createToolCall(messages: LLMMessage[], tools: ToolDefinition[], options?: ChatOptions): Promise<ChatResponse> {
    return this.chat(messages, { ...options, tools });
  }

  async listModels(): Promise<ModelInfo[]> {
    // Pricing in USD/M tokens (converted from CNY at ~7x rate, official 2026/06).
    // Source: https://api-docs.deepseek.com/quick_start/pricing
    return [
      {
        id: 'deepseek-v4-flash',
        name: 'deepseek-v4-flash',
        provider: this.provider,
        displayName: 'DeepSeek V4 Flash',
        description: 'DeepSeek-V4-Flash, 1M context, supports thinking/non-thinking modes',
        contextWindow: 1_000_000,
        supportedFeatures: {
          streaming: true,
          toolCalling: true,
          vision: false,
          functionCalling: true,
        },
        pricing: { input: 0.14, output: 0.28, currency: 'USD' },
      },
      {
        id: 'deepseek-v4-pro',
        name: 'deepseek-v4-pro',
        provider: this.provider,
        displayName: 'DeepSeek V4 Pro',
        description: 'DeepSeek-V4-Pro, 1M context, higher quality',
        contextWindow: 1_000_000,
        supportedFeatures: {
          streaming: true,
          toolCalling: true,
          vision: false,
          functionCalling: true,
        },
        pricing: { input: 0.42, output: 0.84, currency: 'USD' },
      },
      // Legacy aliases — server-side alias to v4-flash, scheduled removal 2026/07/24
      {
        id: 'deepseek-chat',
        name: 'deepseek-chat',
        provider: this.provider,
        displayName: 'DeepSeek Chat (Legacy)',
        description: '[DEPRECATED 2026/07/24] Non-thinking mode of deepseek-v4-flash',
        contextWindow: 1_000_000,
        supportedFeatures: {
          streaming: true,
          toolCalling: true,
          vision: false,
          functionCalling: true,
        },
        pricing: { input: 0.14, output: 0.28, currency: 'USD' },
      },
      {
        id: 'deepseek-reasoner',
        name: 'deepseek-reasoner',
        provider: this.provider,
        displayName: 'DeepSeek Reasoner (Legacy)',
        description: '[DEPRECATED 2026/07/24] Thinking mode of deepseek-v4-flash',
        contextWindow: 1_000_000,
        supportedFeatures: {
          streaming: true,
          toolCalling: true,
          vision: false,
          functionCalling: true,
        },
        pricing: { input: 0.14, output: 0.28, currency: 'USD' },
      },
    ];
  }

  async getModel(modelId: string): Promise<ModelInfo | null> {
    const models = await this.listModels();
    return models.find(m => m.id === modelId) || null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.client) await this.initialize();
      // Simple health check - verify client is initialized
      return this.client !== null;
    } catch {
      return false;
    }
  }
}
