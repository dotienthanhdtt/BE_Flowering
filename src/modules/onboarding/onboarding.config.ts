import { LLMModel } from '../ai/providers/llm-models.enum';

/** Static configuration for the anonymous onboarding chat feature. */
export const onboardingConfig = {
  maxTurns: 8,
  sessionTtlDays: 7,
  llmModel: LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW,
  maxTokens: 1024,
  temperature: 0,
};
