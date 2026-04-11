import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ITokenUsage extends Document {
  userId: string;
  sessionId?: string;
  conversationId?: mongoose.Types.ObjectId;
  modelId: string;
  modelProvider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCost: number;
  completionCost: number;
  totalCost: number;
  endpoint: string;
  requestType: 'chat' | 'stream' | 'tool' | 'other';
  responseTimeMs: number;
  inputPricePerM: number;
  outputPricePerM: number;
  createdAt: Date;
  updatedAt: Date;
}

// Static methods interface
export interface ITokenUsageModel extends Model<ITokenUsage> {
  getUserStats(userId: string, startDate?: Date, endDate?: Date): Promise<any>;
  getUserStatsByModel(userId: string, startDate?: Date, endDate?: Date): Promise<any>;
  getDailyStats(userId: string, days?: number): Promise<any>;
}

// Pricing per million tokens (USD) - as of 2026
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022':  { input: 0.8, output: 4 },
  'claude-3-opus-20240229':     { input: 15, output: 75 },
  'claude-3-sonnet-20240229':   { input: 3, output: 15 },

  // OpenAI
  'gpt-4o':           { input: 2.5, output: 10 },
  'gpt-4-turbo':      { input: 10, output: 30 },
  'gpt-4':            { input: 30, output: 60 },
  'gpt-3.5-turbo':    { input: 0.5, output: 1.5 },

  // Google
  'gemini-2.0-flash':  { input: 0, output: 0.1 },
  'gemini-1.5-pro':    { input: 1.25, output: 5 },
  'gemini-1.5-flash':  { input: 0.075, output: 0.3 },

  // DeepSeek
  'deepseek-chat':     { input: 0.27, output: 1.1 },
  'deepseek-coder':    { input: 0.27, output: 1.1 },

  // Ollama (free, local)
  'llama2':            { input: 0, output: 0 },
  'llama3':            { input: 0, output: 0 },
  'mistral':           { input: 0, output: 0 },
  'codellama':         { input: 0, output: 0 },
  'phi3':              { input: 0, output: 0 },

  // SiliconFlow (OpenAI compatible — used by frontend by default)
  'Qwen/Qwen2.5-7B-Instruct': { input: 0, output: 0 },  // free tier
  'Qwen/Qwen3-32B':           { input: 0, output: 0 },  // free tier
  'deepseek-ai/DeepSeek-V2.5': { input: 0, output: 0 },  // free tier
  'THUDM/glm-4-9b-chat':       { input: 0, output: 0 },  // free tier

  // OpenAI Compatible
  'moonshot-v1-8k':    { input: 1, output: 2 },
  'moonshot-v1-32k':   { input: 1, output: 2 },
  'moonshot-v1-128k':  { input: 1, output: 2 },
};

export function getModelPricing(modelId: string, provider: string): { input: number; output: number } {
  if (MODEL_PRICING[modelId]) {
    return MODEL_PRICING[modelId];
  }
  // Default pricing for unknown models
  return { input: 1, output: 3 };
}

export function calculateCost(modelId: string, promptTokens: number, completionTokens: number): { promptCost: number; completionCost: number; totalCost: number } {
  const pricing = getModelPricing(modelId, '');
  const promptCost = (promptTokens / 1_000_000) * pricing.input;
  const completionCost = (completionTokens / 1_000_000) * pricing.output;
  return {
    promptCost: Math.round(promptCost * 1000000) / 1000000,
    completionCost: Math.round(completionCost * 1000000) / 1000000,
    totalCost: Math.round((promptCost + completionCost) * 1000000) / 1000000,
  };
}

const TokenUsageSchema = new Schema<ITokenUsage>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      index: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
    },
    modelId: {
      type: String,
      required: true,
      index: true,
    },
    modelProvider: {
      type: String,
      required: true,
      index: true,
    },
    promptTokens: {
      type: Number,
      default: 0,
    },
    completionTokens: {
      type: Number,
      default: 0,
    },
    totalTokens: {
      type: Number,
      default: 0,
    },
    promptCost: {
      type: Number,
      default: 0,
    },
    completionCost: {
      type: Number,
      default: 0,
    },
    totalCost: {
      type: Number,
      default: 0,
    },
    endpoint: {
      type: String,
      default: '/chat',
    },
    requestType: {
      type: String,
      enum: ['chat', 'stream', 'tool', 'other'],
      default: 'chat',
    },
    responseTimeMs: {
      type: Number,
      default: 0,
    },
    inputPricePerM: {
      type: Number,
      default: 0,
    },
    outputPricePerM: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'token_usages',
  }
);

// Compound indexes for common queries
TokenUsageSchema.index({ userId: 1, createdAt: -1 });
TokenUsageSchema.index({ userId: 1, modelProvider: 1, createdAt: -1 });
TokenUsageSchema.index({ userId: 1, modelId: 1, createdAt: -1 });
TokenUsageSchema.index({ conversationId: 1, createdAt: -1 });

// Static aggregation methods
TokenUsageSchema.statics.getUserStats = async function (userId: string, startDate?: Date, endDate?: Date) {
  const match: Record<string, any> = { userId };
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = startDate;
    if (endDate) match.createdAt.$lte = endDate;
  }

  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalPromptTokens: { $sum: '$promptTokens' },
        totalCompletionTokens: { $sum: '$completionTokens' },
        totalTokens: { $sum: '$totalTokens' },
        totalCost: { $sum: '$totalCost' },
        requestCount: { $sum: 1 },
      },
    },
  ]);

  return stats[0] || {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    requestCount: 0,
  };
};

TokenUsageSchema.statics.getUserStatsByModel = async function (userId: string, startDate?: Date, endDate?: Date) {
  const match: Record<string, any> = { userId };
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = startDate;
    if (endDate) match.createdAt.$lte = endDate;
  }

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: { modelId: '$modelId', modelProvider: '$modelProvider' },
        totalPromptTokens: { $sum: '$promptTokens' },
        totalCompletionTokens: { $sum: '$completionTokens' },
        totalTokens: { $sum: '$totalTokens' },
        totalCost: { $sum: '$totalCost' },
        requestCount: { $sum: 1 },
      },
    },
    { $sort: { totalCost: -1 } },
  ]);
};

TokenUsageSchema.statics.getDailyStats = async function (userId: string, days: number = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return this.aggregate([
    { $match: { userId, createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' },
        },
        totalPromptTokens: { $sum: '$promptTokens' },
        totalCompletionTokens: { $sum: '$completionTokens' },
        totalTokens: { $sum: '$totalTokens' },
        totalCost: { $sum: '$totalCost' },
        requestCount: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
  ]);
};

export const TokenUsageModel = mongoose.model<ITokenUsage, ITokenUsageModel>('TokenUsage', TokenUsageSchema);

export default TokenUsageModel;
