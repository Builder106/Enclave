import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { computeCostUsd, computeEgressBytes, getLanguageModel } from '@/lib/providers';
import { BEDROCK_PRICING, GROQ_PRICING } from '@/lib/contract';

const mockChatModel = vi.fn((modelId: string) => ({ id: modelId }));
const mockLanguageModel = vi.fn((modelId: string) => ({ id: modelId }));
const mockCreateOpenAICompatible = vi.fn((_opts: unknown) => ({
  chatModel: mockChatModel,
}));
const mockCreateAmazonBedrock = vi.fn((_opts: unknown) => ({
  languageModel: mockLanguageModel,
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (opts: unknown) => mockCreateOpenAICompatible(opts),
}));

vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: (opts: unknown) => mockCreateAmazonBedrock(opts),
}));

describe('providers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getLanguageModel', () => {
    it('configures local ollama provider with defaults', () => {
      delete process.env.OLLAMA_MODEL;
      delete process.env.OLLAMA_BASE_URL;

      const res = getLanguageModel('local');
      expect(res.modelId).toBe('qwen2.5:3b-instruct');
      expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
        name: 'ollama',
        baseURL: 'http://localhost:11434/v1',
        supportsStructuredOutputs: true,
      });
      expect(mockChatModel).toHaveBeenCalledWith('qwen2.5:3b-instruct');
    });

    it('configures local ollama provider with env vars and model override', () => {
      process.env.OLLAMA_MODEL = 'env-model';
      process.env.OLLAMA_BASE_URL = 'http://custom-ollama:11434/v1';

      const res = getLanguageModel('local', 'override-model');
      expect(res.modelId).toBe('override-model');
      expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
        name: 'ollama',
        baseURL: 'http://custom-ollama:11434/v1',
        supportsStructuredOutputs: true,
      });
      expect(mockChatModel).toHaveBeenCalledWith('override-model');
    });

    it('configures groq provider with defaults and throws if apiKey missing', () => {
      delete process.env.GROQ_API_KEY;
      expect(() => getLanguageModel('groq')).toThrow('GROQ_API_KEY is not set');

      process.env.GROQ_API_KEY = 'gsk-test';
      delete process.env.GROQ_MODEL;
      delete process.env.GROQ_BASE_URL;

      const res = getLanguageModel('groq');
      expect(res.modelId).toBe('openai/gpt-oss-120b');
      expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
        name: 'groq',
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: 'gsk-test',
        supportsStructuredOutputs: true,
      });
      expect(mockChatModel).toHaveBeenCalledWith('openai/gpt-oss-120b');
    });

    it('configures groq provider with env vars and model override', () => {
      process.env.GROQ_API_KEY = 'gsk-test';
      process.env.GROQ_MODEL = 'groq-env-model';
      process.env.GROQ_BASE_URL = 'https://custom-groq/v1';

      const res = getLanguageModel('groq', 'groq-override');
      expect(res.modelId).toBe('groq-override');
      expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
        name: 'groq',
        baseURL: 'https://custom-groq/v1',
        apiKey: 'gsk-test',
        supportsStructuredOutputs: true,
      });
    });

    it('configures bedrock provider with defaults', () => {
      delete process.env.BEDROCK_MODEL;
      delete process.env.AWS_REGION;

      const res = getLanguageModel('bedrock');
      expect(res.modelId).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
      expect(mockCreateAmazonBedrock).toHaveBeenCalledWith({
        region: 'us-east-1',
      });
      expect(mockLanguageModel).toHaveBeenCalledWith('us.anthropic.claude-haiku-4-5-20251001-v1:0');
    });

    it('configures bedrock provider with custom region and override', () => {
      process.env.BEDROCK_MODEL = 'bedrock-env';
      process.env.AWS_REGION = 'us-west-2';

      const res = getLanguageModel('bedrock', 'bedrock-override');
      expect(res.modelId).toBe('bedrock-override');
      expect(mockCreateAmazonBedrock).toHaveBeenCalledWith({
        region: 'us-west-2',
      });
      expect(mockLanguageModel).toHaveBeenCalledWith('bedrock-override');
    });
  });

  describe('computeCostUsd', () => {
    it('returns 0 for non-hosted providers (rules, local)', () => {
      expect(
        computeCostUsd('rules', 'deterministic', { inputTokens: 1000, outputTokens: 1000 }),
      ).toBe(0);
      expect(
        computeCostUsd('local', 'qwen2.5:3b-instruct', { inputTokens: 1000, outputTokens: 1000 }),
      ).toBe(0);
    });

    it('computes cost for groq known and unknown models', () => {
      const knownModel = 'openai/gpt-oss-120b';
      const pricing = GROQ_PRICING[knownModel];
      const cost = computeCostUsd('groq', knownModel, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      expect(cost).toBe(pricing.inPerMTok + pricing.outPerMTok);

      // Fallback pricing: inPerMTok: 1.0, outPerMTok: 5.0
      const fallbackCost = computeCostUsd('groq', 'unknown-groq-model', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      expect(fallbackCost).toBe(6.0);
    });

    it('computes cost for bedrock known and unknown models', () => {
      const knownModel = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
      const pricing = BEDROCK_PRICING[knownModel];
      const cost = computeCostUsd('bedrock', knownModel, {
        inputTokens: 500_000,
        outputTokens: 200_000,
      });
      expect(cost).toBe((500_000 * pricing.inPerMTok + 200_000 * pricing.outPerMTok) / 1e6);

      const fallbackCost = computeCostUsd('bedrock', 'unknown-bedrock-model', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      expect(fallbackCost).toBe(6.0);
    });
  });

  describe('computeEgressBytes', () => {
    it('returns 0 for local and rules providers', () => {
      expect(computeEgressBytes('rules', 'hello world')).toBe(0);
      expect(computeEgressBytes('local', 'hello world')).toBe(0);
    });

    it('computes utf-8 byte length for hosted providers', () => {
      const text = 'hello world with emoji 🌟';
      const expectedBytes = Buffer.byteLength(text, 'utf8');
      expect(computeEgressBytes('groq', text)).toBe(expectedBytes);
      expect(computeEgressBytes('bedrock', text)).toBe(expectedBytes);
    });
  });
});
