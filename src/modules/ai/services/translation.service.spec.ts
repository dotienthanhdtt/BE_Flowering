import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AiConversationType } from '../../../database/entities/ai-conversation.entity';

// Mock ESM-dependent modules to prevent dynamic import errors in LLM providers
jest.mock('../providers/openai-llm.provider', () => ({}));
jest.mock('../providers/anthropic-llm.provider', () => ({}));
jest.mock('../providers/gemini-llm.provider', () => ({}));
jest.mock('./unified-llm.service');
jest.mock('./prompt-loader.service');

import { TranslationService } from './translation.service';

describe('TranslationService', () => {
  let service: TranslationService;
  let vocabularyRepo: any;
  let messageRepo: any;
  let llmService: any;
  let promptLoader: any;

  const mockQueryBuilder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orUpdate: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({
      generatedMaps: [{ id: 'vocab-123' }],
      raw: [{ id: 'vocab-123' }],
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    vocabularyRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };
    messageRepo = { findOne: jest.fn(), save: jest.fn() };
    llmService = { chat: jest.fn() };
    promptLoader = { loadPrompt: jest.fn().mockReturnValue('prompt') };

    // Instantiate directly to avoid ESM import issues with NestJS test module
    service = new TranslationService(
      vocabularyRepo, messageRepo, llmService, promptLoader,
    );
  });

  describe('translateWord', () => {
    const llmJson = JSON.stringify({
      translation: 'hola', partOfSpeech: 'noun',
      pronunciation: 'oh-lah', definition: 'a greeting',
      examples: ['Hello there', 'Say hello'],
    });

    it('should translate and upsert vocabulary for authenticated user', async () => {
      llmService.chat.mockResolvedValue(llmJson);

      const result = await service.translateWord('hello', 'en', 'es', 'user-1');

      expect(result.translation).toBe('hola');
      expect(result.vocabularyId).toBe('vocab-123');
      expect(result.definition).toBe('a greeting');
      expect(result.examples).toEqual(['Hello there', 'Say hello']);
      expect(mockQueryBuilder.insert).toHaveBeenCalled();
    });

    it('should return translation without vocabularyId for anonymous user', async () => {
      llmService.chat.mockResolvedValue(llmJson);
      mockQueryBuilder.insert.mockClear();

      const result = await service.translateWord('hello', 'en', 'es', null, 'conv-abc');

      expect(result.translation).toBe('hola');
      expect(result.vocabularyId).toBeUndefined();
      expect(mockQueryBuilder.insert).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when no userId and no conversationId', async () => {
      await expect(service.translateWord('hello', 'en', 'es', null)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should fallback to raw response when JSON parse fails', async () => {
      llmService.chat.mockResolvedValue('just a raw translation');

      const result = await service.translateWord('hello', 'en', 'es', null, 'conv-abc');

      expect(result.translation).toBe('just a raw translation');
    });

    it('should extract JSON from mixed LLM response', async () => {
      llmService.chat.mockResolvedValue('Here: {"translation": "hola", "partOfSpeech": "noun"}');

      const result = await service.translateWord('hello', 'en', 'es', null, 'conv-abc');

      expect(result.translation).toBe('hola');
      expect(result.partOfSpeech).toBe('noun');
    });

    it('should trim whitespace from LLM JSON response', async () => {
      llmService.chat.mockResolvedValue(`\n  {"translation": "hola"}  \n`);

      const result = await service.translateWord('hello', 'en', 'es', null, 'conv-abc');

      expect(result.translation).toBe('hola');
    });
  });

  describe('translateSentence', () => {
    const mockMessage = (overrides: any = {}) => ({
      id: 'msg-1',
      content: 'How are you?',
      translatedContent: null,
      translatedLang: null,
      conversation: {
        id: 'conv-1', userId: 'user-1',
        type: AiConversationType.AUTHENTICATED,
      },
      ...overrides,
    });

    it('should translate sentence for authenticated user', async () => {
      messageRepo.findOne.mockResolvedValue(mockMessage());
      llmService.chat.mockResolvedValue('¿Cómo estás?');
      messageRepo.save.mockImplementation((m: any) => Promise.resolve(m));

      const result = await service.translateSentence('msg-1', 'en', 'es', 'user-1');

      expect(result.translation).toBe('¿Cómo estás?');
      expect(messageRepo.save).toHaveBeenCalled();
    });

    it('should return cached translation if available', async () => {
      messageRepo.findOne.mockResolvedValue(
        mockMessage({ translatedContent: 'cached', translatedLang: 'es' }),
      );

      const result = await service.translateSentence('msg-1', 'en', 'es', 'user-1');

      expect(result.translation).toBe('cached');
      expect(llmService.chat).not.toHaveBeenCalled();
    });

    it('should translate for anonymous user with valid conversationId', async () => {
      messageRepo.findOne.mockResolvedValue(
        mockMessage({
          conversation: {
            id: 'conv-1', userId: null,
            type: AiConversationType.ANONYMOUS,
          },
        }),
      );
      llmService.chat.mockResolvedValue('¿Cómo estás?');
      messageRepo.save.mockImplementation((m: any) => Promise.resolve(m));

      const result = await service.translateSentence('msg-1', 'en', 'es', null, 'conv-1');

      expect(result.translation).toBe('¿Cómo estás?');
    });

    it('should throw ForbiddenException when conversationId does not match', async () => {
      messageRepo.findOne.mockResolvedValue(
        mockMessage({
          conversation: {
            id: 'conv-1', userId: null,
            type: AiConversationType.ANONYMOUS,
          },
        }),
      );

      await expect(
        service.translateSentence('msg-1', 'en', 'es', null, 'wrong-conv-id'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when userId does not match', async () => {
      messageRepo.findOne.mockResolvedValue(mockMessage());

      await expect(
        service.translateSentence('msg-1', 'en', 'es', 'other-user'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when message not found', async () => {
      messageRepo.findOne.mockResolvedValue(null);

      await expect(
        service.translateSentence('msg-1', 'en', 'es', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when no userId and no conversationId', async () => {
      await expect(
        service.translateSentence('msg-1', 'en', 'es', null),
      ).rejects.toThrow(BadRequestException);
    });

    it('should re-translate when cached lang differs from target', async () => {
      messageRepo.findOne.mockResolvedValue(
        mockMessage({ translatedContent: 'Bonjour', translatedLang: 'fr' }),
      );
      llmService.chat.mockResolvedValue('¿Cómo estás?');
      messageRepo.save.mockImplementation((m: any) => Promise.resolve(m));

      const result = await service.translateSentence('msg-1', 'en', 'es', 'user-1');

      expect(llmService.chat).toHaveBeenCalled();
      expect(result.translation).toBe('¿Cómo estás?');
    });
  });
});
