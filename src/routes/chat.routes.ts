import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, apiKeyMiddleware } from '../middleware/auth';
import { getTemporaryMemory } from '../core/memory/TemporaryMemory';
import { getPermanentMemory } from '../core/memory/PermanentMemory';
import { getLLMManager } from '../core/llm/LLMFactory';
import { getSkillManager } from '../core/skills/SkillManager';
import { getToolManager } from '../core/tools/ToolManager';
import { getTokenService } from '../services/TokenService';
import { generateSessionId, generateMessageId, now } from '../utils/helpers';
import { logger } from '../utils/logger';
import { TempMessage, LLMMessage } from '../core/llm/types';

const router = Router();

// Apply authentication to all chat routes
router.use(apiKeyMiddleware);
router.use(authMiddleware(false));

// Send message
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, message, model, provider, agentId } = req.body;
  const userId = req.user?.userId || req.apiKey?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'User ID required' },
    });
  }

  if (!message || typeof message !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_MESSAGE', message: 'Message is required' },
    });
  }

  const session = sessionId || generateSessionId();
  const messageId = generateMessageId();
  const startTime = Date.now();
  const llmManager = getLLMManager();
  const tempMemory = getTemporaryMemory();
  const permanentMemory = getPermanentMemory();

  // Create user message
  const userMsg: Omit<TempMessage, 'id' | 'timestamp'> = {
    userId,
    sessionId: session,
    role: 'user',
    content: message,
    modelId: model,
    modelProvider: provider,
  };

  // Save to temporary memory
  await tempMemory.addMessage(session, userMsg);

  // Get conversation history
  const history = await tempMemory.getMessages(session);

  // Convert to LLM format
  const llmMessages: LLMMessage[] = history.map(msg => ({
    role: msg.role as LLMMessage['role'],
    content: msg.content,
  }));

  // Execute skills (preprocessing)
  const skillManager = getSkillManager();
  let contextVariables: Record<string, any> = {};

  if (skillManager) {
    const currentMessage = {
      id: messageId,
      role: 'user' as const,
      content: message,
      timestamp: now(),
    };

    const skillContext = {
      userId,
      sessionId: session,
      messages: history,
      currentMessage,
      variables: contextVariables,
      metadata: { modelId: model, modelProvider: provider, agentId },
    };

    const processedContext = await skillManager.executeSkills(skillContext);
    contextVariables = processedContext.variables || {};

    // Update the last message if modified
    if (processedContext.currentMessage.content !== message) {
      llmMessages[llmMessages.length - 1] = {
        role: 'user',
        content: processedContext.currentMessage.content,
      };
    }
  }

  // Get available tools
  const toolManager = getToolManager();
  const tools = toolManager?.listTools() || [];

  // Call LLM
  const response = await llmManager.chat(llmMessages, {
    model,
    tools: tools.length > 0 ? tools : undefined,
  });

  // Save assistant response to temporary memory
  const assistantMsg: Omit<TempMessage, 'id' | 'timestamp'> = {
    userId,
    sessionId: session,
    role: 'assistant',
    content: response.content,
    modelId: response.model,
    modelProvider: response.provider,
  };

  await tempMemory.addMessage(session, assistantMsg);

  // Save to permanent memory (if conversation exists)
  const conversation = await permanentMemory.getConversationBySessionId(session);
  if (conversation) {
    await permanentMemory.addMessage(conversation.id, {
      role: 'user',
      content: message,
      modelId: model,
      modelProvider: provider,
    });
    await permanentMemory.addMessage(conversation.id, {
      role: 'assistant',
      content: response.content,
      modelId: response.model,
      modelProvider: response.provider,
    });
  }

  // Record token usage
  const endTime = Date.now();
  if (response.usage && response.usage.totalTokens > 0) {
    const tokenService = getTokenService();
    await tokenService.recordUsage({
      userId,
      sessionId: session,
      conversationId: conversation?.id?.toString(),
      modelId: response.model,
      modelProvider: response.provider,
      promptTokens: response.usage.inputTokens,
      completionTokens: response.usage.outputTokens,
      totalTokens: response.usage.totalTokens,
      endpoint: '/chat',
      requestType: 'chat',
      responseTimeMs: endTime - startTime,
    }).catch(err => logger.error('Failed to record token usage:', err));
  }

  res.json({
    success: true,
    data: {
      sessionId: session,
      messageId: response.id,
      content: response.content,
      model: response.model,
      provider: response.provider,
      finishReason: response.finishReason,
      usage: response.usage,
      toolCalls: response.toolCalls,
    },
  });
}));

// Stream message
router.post('/stream', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, message, model, provider } = req.body;
  const userId = req.user?.userId || req.apiKey?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'User ID required' },
    });
  }

  if (!message || typeof message !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_MESSAGE', message: 'Message is required' },
    });
  }

  const session = sessionId || generateSessionId();
  const llmManager = getLLMManager();
  const tempMemory = getTemporaryMemory();
  const permanentMemory = getPermanentMemory();
  const startTime = Date.now();

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // Get conversation history
    const history = await tempMemory.getMessages(session);

    const llmMessages: LLMMessage[] = [
      ...history.map(msg => ({
        role: msg.role as LLMMessage['role'],
        content: msg.content,
      })),
      { role: 'user', content: message },
    ];

    let fullContent = '';

    // Stream response
    for await (const chunk of llmManager.streamChat(llmMessages, { model })) {
      if (chunk.type === 'content' && chunk.content) {
        fullContent += chunk.content;
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
      } else if (chunk.type === 'done') {
        // Save to temporary memory
        await tempMemory.addMessage(session, {
          userId,
          sessionId: session,
          role: 'user',
          content: message,
        });

        await tempMemory.addMessage(session, {
          userId,
          sessionId: session,
          role: 'assistant',
          content: fullContent,
          modelId: model,
          modelProvider: provider,
        });

        // Record token usage for stream
        if (chunk.usage && chunk.usage.totalTokens > 0) {
          const tokenService = getTokenService();
          tokenService.recordUsage({
            userId,
            sessionId: session,
            modelId: model || 'unknown',
            modelProvider: provider || 'unknown',
            promptTokens: chunk.usage.inputTokens,
            completionTokens: chunk.usage.outputTokens,
            totalTokens: chunk.usage.totalTokens,
            endpoint: '/chat/stream',
            requestType: 'stream',
            responseTimeMs: Date.now() - startTime,
          }).catch(err => logger.error('Failed to record stream token usage:', err));
        }

        res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent })}\n\n`);
      } else if (chunk.type === 'error') {
        res.write(`data: ${JSON.stringify({ type: 'error', error: chunk.error })}\n\n`);
      }
    }
  } catch (error) {
    logger.error('Stream error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Stream failed' })}\n\n`);
  }

  res.end();
}));

// Get chat history
router.get('/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { limit } = req.query;

  const tempMemory = getTemporaryMemory();
  const messages = await tempMemory.getMessages(sessionId, limit ? parseInt(limit as string) : undefined);

  res.json({
    success: true,
    data: messages,
  });
}));

// Clear chat (temporary memory)
router.post('/:sessionId/clear', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  const tempMemory = getTemporaryMemory();
  await tempMemory.clearMessages(sessionId);

  res.json({
    success: true,
    message: 'Chat cleared',
  });
}));

// Delete session
router.delete('/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  const tempMemory = getTemporaryMemory();
  const permanentMemory = getPermanentMemory();

  // Clear temporary memory
  await tempMemory.clearMessages(sessionId);

  // Delete from permanent memory
  const conversation = await permanentMemory.getConversationBySessionId(sessionId);
  if (conversation) {
    await permanentMemory.deleteConversation(conversation.id);
  }

  res.json({
    success: true,
    message: 'Session deleted',
  });
}));

export default router;
