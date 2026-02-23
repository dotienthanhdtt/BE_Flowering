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

  // Anthropic Models
  ANTHROPIC_CLAUDE_3_5_SONNET = 'claude-3-5-sonnet-20241022',
  ANTHROPIC_CLAUDE_3_HAIKU = 'claude-3-haiku-20240307',

  // Gemini Models
  GEMINI_2_5_FLASH = 'gemini-2.5-flash-preview-05-20',
  GEMINI_2_0_FLASH = 'gemini-2.0-flash',
  GEMINI_1_5_PRO = 'gemini-1.5-pro',
  GEMINI_1_5_FLASH = 'gemini-1.5-flash',
}

export type LLMProviderType = 'openai' | 'anthropic' | 'gemini';

/**
 * Determines the provider from the model enum value.
 */
export function getProviderFromModel(model: LLMModel): LLMProviderType {
  const modelValue = model as string;
  if (modelValue.startsWith('gpt-') || modelValue.startsWith('o1')) {
    return 'openai';
  } else if (modelValue.startsWith('claude-')) {
    return 'anthropic';
  } else if (modelValue.startsWith('gemini-')) {
    return 'gemini';
  }
  throw new Error(`Unknown model provider for: ${model}`);
}
