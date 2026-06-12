import { ClaudeAdapter } from '../../src/core/llm/adapters/ClaudeAdapter';
import { toOpenAIMessages } from '../../src/core/llm/adapters/DeepSeekAdapter';
import { OpenAIAdapter } from '../../src/core/llm/adapters/OpenAIAdapter';

describe('LLM Adapters', () => {
  describe('ClaudeAdapter', () => {
    let adapter: ClaudeAdapter;

    beforeEach(() => {
      adapter = new ClaudeAdapter('test-api-key');
    });

    it('should create an instance', () => {
      expect(adapter).toBeDefined();
      expect(adapter.provider).toBe('anthropic');
    });

    it('should have correct name', () => {
      expect(adapter.name).toBe('ClaudeAdapter');
    });

    it('should list available models', async () => {
      const models = await adapter.listModels();
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    it('should get model info', async () => {
      const model = await adapter.getModel('claude-3-5-sonnet-20241022');
      expect(model).toBeDefined();
      expect(model?.id).toBe('claude-3-5-sonnet-20241022');
    });

    it('should return null for unknown model', async () => {
      const model = await adapter.getModel('unknown-model');
      expect(model).toBeNull();
    });

    it('should perform health check', async () => {
      // Without proper API key, health check should still work (client initialized)
      await adapter.initialize();
      const healthy = await adapter.healthCheck();
      expect(typeof healthy).toBe('boolean');
    });
  });

  describe('OpenAIAdapter', () => {
    let adapter: OpenAIAdapter;

    beforeEach(() => {
      adapter = new OpenAIAdapter('test-api-key');
    });

    it('should create an instance', () => {
      expect(adapter).toBeDefined();
      expect(adapter.provider).toBe('openai');
    });

    it('should list available models', async () => {
      const models = await adapter.listModels();
      expect(models).toBeDefined();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    it('should get model info', async () => {
      const model = await adapter.getModel('gpt-4o');
      expect(model).toBeDefined();
      expect(model?.id).toBe('gpt-4o');
    });
  });

  describe('DeepSeekAdapter message conversion', () => {
    it('passes reasoning_content back on regular assistant messages', () => {
      const messages = toOpenAIMessages([
        {
          role: 'assistant',
          content: '上一轮答案',
          providerExtras: { reasoningContent: 'internal reasoning token' },
        },
      ]);

      expect(messages[0]).toMatchObject({
        role: 'assistant',
        content: '上一轮答案',
        reasoning_content: 'internal reasoning token',
      });
    });

    it('passes reasoning_content back on assistant tool-call messages', () => {
      const messages = toOpenAIMessages([
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'divination', input: { action: 'analyze' } }],
          providerExtras: { reasoningContent: 'tool reasoning token' },
        },
      ]);

      expect(messages[0]).toMatchObject({
        role: 'assistant',
        content: null,
        reasoning_content: 'tool reasoning token',
      });
    });
  });
});
