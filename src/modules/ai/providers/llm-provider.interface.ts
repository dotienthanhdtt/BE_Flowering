import { BaseMessage } from '@langchain/core/messages';
import { LLMModel, ThinkingLevel } from './llm-models.enum';

export interface LLMOptions {
  model: LLMModel;
  temperature?: number;
  maxTokens?: number;
  /** Gemini thinking config for models that support extended thinking. */
  thinkingConfig?: { thinkingLevel: ThinkingLevel };
  metadata?: Record<string, unknown>;
}

export interface LLMProvider {
  chat(messages: BaseMessage[], options: LLMOptions): Promise<string>;
  stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string>;
}
