import { LLMModel } from '../ai/providers/llm-models.enum';

/** Static configuration for the anonymous onboarding chat feature. */
export const onboardingConfig = {
  maxTurns: 10,
  sessionTtlDays: 7,
  llmModel: LLMModel.GEMINI_2_0_FLASH,
  maxTokens: 1024,
  temperature: 0.7,
};
