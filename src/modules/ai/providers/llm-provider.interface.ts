import { BaseMessage } from '@langchain/core/messages';
import { LLMModel } from './llm-models.enum';

export interface LLMOptions {
  model: LLMModel;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface LLMProvider {
  chat(messages: BaseMessage[], options: LLMOptions): Promise<string>;
  stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string>;
}
