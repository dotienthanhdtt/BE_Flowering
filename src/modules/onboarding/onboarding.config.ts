import { LLMModel } from '../ai/providers/llm-models.enum';
import { AiConversationType } from '../../database/entities/ai-conversation.entity';
import { LangfuseFeature } from '../ai/langfuse-feature.enum';
import type { IntakeChatEngineConfig } from '../ai/services/intake-chat-engine.types';

/** Static configuration for the anonymous onboarding chat feature. */
export const onboardingConfig = {
  maxTurns: 8,
  llmModel: LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW,
  maxTokens: 1024,
  temperature: 0,
};

/** IntakeChatEngine config for anonymous onboarding. */
export const onboardingEngineConfig: IntakeChatEngineConfig = {
  chatPromptKey: 'onboarding-chat-prompt.json',
  extractionPromptKey: 'onboarding-extraction-prompt.md',
  scenariosPromptKey: 'onboarding-scenarios-prompt.json',
  maxTurns: onboardingConfig.maxTurns,
  conversationType: AiConversationType.ANONYMOUS,
  chatFeature: LangfuseFeature.ONBOARDING_CHAT,
  extractionFeature: LangfuseFeature.ONBOARDING_EXTRACTION,
  scenariosFeature: LangfuseFeature.ONBOARDING_SCENARIOS,
  // Route the per-turn onboarding chat through the 9router gateway; fall back to
  // Gemini if 9router is unavailable so onboarding still works.
  chatModel: LLMModel.NINEROUTER_FLOWERING_CHAT,
  chatFallbackModel: LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW,
};
