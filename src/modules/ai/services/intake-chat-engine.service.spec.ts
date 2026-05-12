import { ServiceUnavailableException } from '@nestjs/common';

// Mock ESM-dependent modules to prevent dynamic import errors in LLM providers
jest.mock('../providers/openai-llm.provider', () => ({}));
jest.mock('../providers/anthropic-llm.provider', () => ({}));
jest.mock('../providers/gemini-llm.provider', () => ({}));
jest.mock('./unified-llm.service');
jest.mock('./prompt-loader.service');

import { IntakeChatEngine } from './intake-chat-engine.service';
import { LLMModel } from '../providers/llm-models.enum';
import { LangfuseFeature } from '../langfuse-feature.enum';
import type { IntakeChatEngineConfig } from './intake-chat-engine.types';
import { AiConversationType } from '../../../database/entities/ai-conversation.entity';

describe('IntakeChatEngine', () => {
  let engine: IntakeChatEngine;
  let conversationRepo: any;
  let messageRepo: any;
  let llmService: any;
  let promptLoader: any;

  const baseConfig: IntakeChatEngineConfig = {
    chatPromptKey: 'chat.json',
    extractionPromptKey: 'extract.md',
    scenariosPromptKey: 'scenarios.json',
    maxTurns: 8,
    conversationType: AiConversationType.ANONYMOUS,
    chatFeature: LangfuseFeature.ONBOARDING_CHAT,
    extractionFeature: LangfuseFeature.ONBOARDING_EXTRACTION,
    scenariosFeature: LangfuseFeature.ONBOARDING_SCENARIOS,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    conversationRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'conv-1', messageCount: 0, type: AiConversationType.ANONYMOUS }),
      increment: jest.fn().mockResolvedValue(undefined),
    };
    messageRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    llmService = { chat: jest.fn() };
    promptLoader = { loadPrompt: jest.fn().mockReturnValue('system prompt') };

    engine = new IntakeChatEngine(conversationRepo, messageRepo, llmService, promptLoader);
  });

  const reply = JSON.stringify({ reply: 'hello', isLastTurn: false });

  it('uses the default Gemini model when config sets no chatModel', async () => {
    llmService.chat.mockResolvedValue(reply);

    await engine.runTurn('conv-1', undefined, {}, baseConfig);

    expect(llmService.chat).toHaveBeenCalledTimes(1);
    expect(llmService.chat.mock.calls[0][1].model).toBe(LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW);
  });

  it('routes the chat turn through config.chatModel when set', async () => {
    llmService.chat.mockResolvedValue(reply);
    const config: IntakeChatEngineConfig = {
      ...baseConfig,
      chatModel: LLMModel.NINEROUTER_FLOWERING_CHAT,
      chatFallbackModel: LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW,
    };

    await engine.runTurn('conv-1', undefined, {}, config);

    expect(llmService.chat.mock.calls[0][1].model).toBe(LLMModel.NINEROUTER_FLOWERING_CHAT);
  });

  it('falls back to chatFallbackModel when the primary model is unavailable', async () => {
    llmService.chat
      .mockRejectedValueOnce(new ServiceUnavailableException('9router down'))
      .mockResolvedValueOnce(reply);
    const config: IntakeChatEngineConfig = {
      ...baseConfig,
      chatModel: LLMModel.NINEROUTER_FLOWERING_CHAT,
      chatFallbackModel: LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW,
    };

    const result = await engine.runTurn('conv-1', undefined, {}, config);

    expect(result.reply).toBe('hello');
    expect(llmService.chat).toHaveBeenCalledTimes(2);
    expect(llmService.chat.mock.calls[1][1].model).toBe(LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW);
    expect(llmService.chat.mock.calls[1][1].metadata.fallback).toBe('flowering_chat->gemini-3.1-flash-lite');
  });

  it('propagates non-availability errors without falling back', async () => {
    llmService.chat.mockRejectedValueOnce(new Error('boom'));
    const config: IntakeChatEngineConfig = {
      ...baseConfig,
      chatModel: LLMModel.NINEROUTER_FLOWERING_CHAT,
      chatFallbackModel: LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW,
    };

    await expect(engine.runTurn('conv-1', undefined, {}, config)).rejects.toThrow('boom');
    expect(llmService.chat).toHaveBeenCalledTimes(1);
  });
});
