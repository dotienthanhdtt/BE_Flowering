/**
 * Centralized enum for Langfuse trace feature tags.
 * Used in LLM call metadata to tag and filter traces in the Langfuse dashboard.
 */
export enum LangfuseFeature {
  CHAT = 'chat',
  CHAT_STREAM = 'chat-stream',
  CORRECTION_CHECK = 'correction-check',
  ONBOARDING_CHAT = 'onboarding-chat',
  ONBOARDING_EXTRACTION = 'onboarding-extraction',
  ONBOARDING_SCENARIOS = 'onboarding-scenarios',
  TRANSLATE_WORD = 'translate-word',
  TRANSLATE_SENTENCE = 'translate-sentence',
  TRANSLATE_CHUNK = 'translate-chunk',
  SCENARIO_CHAT = 'scenario-chat',
  ADMIN_CONTENT_GENERATE = 'admin-content-generate',
  PERSONALIZATION_CHAT = 'personalization-chat',
  PERSONALIZATION_EXTRACTION = 'personalization-extraction',
  PERSONALIZATION_SCENARIOS = 'personalization-scenarios',
}
