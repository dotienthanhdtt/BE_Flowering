import { LLMModel } from '../ai/providers/llm-models.enum';

/** Static configuration for the anonymous onboarding chat feature. */
export const onboardingConfig = {
  maxTurns: 10,
  sessionTtlDays: 7,
  llmModel: LLMModel.OPENAI_GPT4O_MINI,
  maxTokens: 1024,
  temperature: 0.7,
};
