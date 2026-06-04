import { IMessage } from '../../types';

// LLM Provider types
export type LLMProvider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'deepseek' | 'kimi' | 'siliconflow' | 'groq' | 'together' | 'perplexity';

// Message format
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  /** Tool-call request emitted by the assistant (assistant turn only). */
  toolCalls?: ToolCall[];
  /** Matches the tool_calls[].id the response is replying to (tool turn). */
  toolCallId?: string;
  /**
   * Provider-specific opaque blob that must be passed back on
   * follow-up calls. The DeepSeek v4 reasoning mode requires
   * `reasoning_content` from the previous assistant turn to be
   * included in the next request, or the API returns
   * "reasoning_content in the thinking mode must be passed back to
   * the API". Other providers use this slot for their own
   * bookkeeping (e.g. Anthropic's signature blocks). The chat
   * loop appends whatever the adapter emits; the adapter knows
   * what shape to put back on the wire.
   */
  providerExtras?: Record<string, unknown>;
}

// Temporary message for Redis storage
export interface TempMessage {
  id: string;
  userId: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  modelId?: string;
  modelProvider?: string;
  metadata?: Record<string, any>;
}

// Chat options
export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  stream?: boolean;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

// Tool definition
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
  };
}

// Chat response
export interface ChatResponse {
  id: string;
  model: string;
  provider: LLMProvider;
  content: string;
  role: 'assistant';
  finishReason: 'stop' | 'length' | 'tool_use' | 'content_filter';
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    /** Subset of `inputTokens` served from the provider's prompt cache
     *  (e.g. DeepSeek's `prompt_tokens_details.cached_tokens`). Defaults to 0
     *  when the provider doesn't break the count down. */
    cacheHitTokens?: number;
  };
  toolCalls?: ToolCall[];
  /**
   * The adapter's "extras" — provider-specific bookkeeping the chat
   * loop must round-trip to the adapter on the next call. For
   * DeepSeek this holds `reasoning_content` from the v4 thinking
   * mode; without it the next /chat call fails with
   * "reasoning_content in the thinking mode must be passed back to
   * the API". Other adapters can set this to whatever they need.
   */
  providerExtras?: Record<string, unknown>;
  raw?: any;
}

// Tool call
export interface ToolCall {
  id: string;
  name: string;
  input: any;
}

// Stream chunk
export interface StreamChunk {
  type: 'content' | 'tool_call' | 'tool_result' | 'error' | 'done';
  content?: string;
  toolCall?: ToolCall;
  error?: string;
  finishReason?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheHitTokens?: number;
  };
}

// Model info
export interface ModelInfo {
  id: string;
  name: string;
  provider: LLMProvider;
  displayName: string;
  description: string;
  contextWindow: number;
  supportedFeatures: {
    streaming: boolean;
    toolCalling: boolean;
    vision: boolean;
    functionCalling?: boolean;
  };
  pricing?: {
    input?: number;
    output?: number;
    currency?: string;
  };
}

// LLM Adapter interface
export interface ILLMAdapter {
  readonly name: string;
  readonly provider: LLMProvider;

  // Core methods
  chat(messages: LLMMessage[], options?: ChatOptions): Promise<ChatResponse>;
  streamChat(messages: LLMMessage[], options?: ChatOptions): AsyncGenerator<StreamChunk>;

  // Tool calling
  createToolCall(messages: LLMMessage[], tools: ToolDefinition[], options?: ChatOptions): Promise<ChatResponse>;

  // Model management
  listModels(): Promise<ModelInfo[]>;
  getModel(modelId: string): Promise<ModelInfo | null>;

  // Health check
  healthCheck(): Promise<boolean>;

  // Initialize
  initialize(): Promise<void>;
  destroy(): Promise<void>;
}

// LLM Factory
export interface LLMFactoryConfig {
  provider: LLMProvider;
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  defaultModel?: string;
}
