/**
 * Enum for all supported LLM models across providers.
 * Model values are the actual API model names.
 */
export enum LLMModel {
  // OpenAI Models
  OPENAI_GPT4O = 'gpt-4o',
  OPENAI_GPT4O_MINI = 'gpt-4o-mini',
  OPENAI_O1_PREVIEW = 'o1-preview',
  OPENAI_O1_MINI = 'o1-mini',
  OPENAI_GPT4_1_NANO = 'gpt-4.1-nano',

  // Anthropic Models
  ANTHROPIC_CLAUDE_3_5_SONNET = 'claude-3-5-sonnet-20241022',
  ANTHROPIC_CLAUDE_3_HAIKU = 'claude-3-haiku-20240307',

  // Gemini Models
  GEMINI_3_1_FLASH_LITE_PREVIEW = 'gemini-3.1-flash-lite',

  // 9router (OpenAI-compatible router gateway) Models
  NINEROUTER_FLOWERING_CHAT = 'flowering_chat',
}

/**
 * Model aliases served by the 9router gateway. These don't follow a provider
 * prefix convention, so they're matched explicitly when routing.
 */
const NINEROUTER_MODELS = new Set<string>([LLMModel.NINEROUTER_FLOWERING_CHAT]);

/** Gemini thinking levels for models that support extended thinking. */
export enum ThinkingLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export type LLMProviderType = 'openai' | 'anthropic' | 'gemini' | 'ninerouter';

/**
 * Determines the provider from the model enum value.
 */
export function getProviderFromModel(model: LLMModel): LLMProviderType {
  const modelValue = model as string;
  if (NINEROUTER_MODELS.has(modelValue)) {
    return 'ninerouter';
  } else if (modelValue.startsWith('gpt-') || modelValue.startsWith('o1')) {
    return 'openai';
  } else if (modelValue.startsWith('claude-')) {
    return 'anthropic';
  } else if (modelValue.startsWith('gemini-')) {
    return 'gemini';
  }
  throw new Error(`Unknown model provider for: ${model}`);
}
