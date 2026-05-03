import { LangfuseFeature } from '../langfuse-feature.enum';

export interface IntakeChatEngineConfig {
  chatPromptKey: string;
  extractionPromptKey: string;
  scenariosPromptKey: string;
  maxTurns: number;
  conversationType: string;
  chatFeature: LangfuseFeature;
  extractionFeature: LangfuseFeature;
  scenariosFeature: LangfuseFeature;
}

export interface IntakeTurnResult {
  reply: string;
  messageId: string;
  turnNumber: number;
  isLastTurn: boolean;
}

export interface IntakeCompleteResult<T> {
  profile: Record<string, unknown>;
  generated: T;
}
