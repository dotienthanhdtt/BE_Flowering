import { LangfuseFeature } from '../langfuse-feature.enum';
import { LLMModel } from '../providers/llm-models.enum';

export interface IntakeChatEngineConfig {
  chatPromptKey: string;
  extractionPromptKey: string;
  scenariosPromptKey: string;
  maxTurns: number;
  conversationType: string;
  chatFeature: LangfuseFeature;
  extractionFeature: LangfuseFeature;
  scenariosFeature: LangfuseFeature;
  /** Model for the per-turn chat call. Defaults to the engine's built-in model when unset. */
  chatModel?: LLMModel;
  /** Model to retry the chat turn with if {@link chatModel} is unavailable (e.g. 9router down). */
  chatFallbackModel?: LLMModel;
}

export interface IntakeTurnResult {
  reply: string;
  messageId: string;
  turnNumber: number;
  isLastTurn: boolean;
  audio_path: string | null;
  translated_content: string | null;
  corrected_content: string | null;
}

export interface IntakeCompleteResult<T> {
  profile: Record<string, unknown>;
  generated: T;
}
