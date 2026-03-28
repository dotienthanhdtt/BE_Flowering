import { BaseMessage } from '@langchain/core/messages';
import { LLMModel, ThinkingLevel } from './llm-models.enum';

export interface LLMOptions {
  model: LLMModel;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
  thinkingConfig?: { thinkingLevel: ThinkingLevel };
}

export interface LLMProvider {
  chat(messages: BaseMessage[], options: LLMOptions): Promise<string>;
  stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string>;
}
