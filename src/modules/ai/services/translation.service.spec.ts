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

    // Regression for SRS Leitner migration: ensure re-translate of an existing word
    // does NOT clobber SRS state (`box`, `due_at`, `last_reviewed_at`,
    // `review_count`, `correct_count`). These columns MUST be absent from the
    // `orUpdate` overwrite column list.
    it('must not include SRS columns in orUpdate conflict overwrite list', async () => {
      llmService.chat.mockResolvedValue(llmJson);
      mockQueryBuilder.orUpdate.mockClear();

      await service.translateWord('hello', 'en', 'es', 'user-1');

      expect(mockQueryBuilder.orUpdate).toHaveBeenCalledTimes(1);
      const [overwriteCols, conflictCols] = mockQueryBuilder.orUpdate.mock.calls[0];
      const srsCols = ['box', 'due_at', 'last_reviewed_at', 'review_count', 'correct_count'];
      for (const col of srsCols) {
        expect(overwriteCols).not.toContain(col);
      }
      // Conflict target remains the original uniqueness key
      expect(conflictCols).toEqual(['user_id', 'word', 'source_lang', 'target_lang']);
    });
  });

  describe('translateChunk', () => {
    const userId = 'user-uuid';
    const messageId = 'msg-uuid';
    const sentence = '我在一家科技公司工作';

    const mockUpsertChain = (id: string) => ({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orUpdate: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        generatedMaps: [{ id }],
        raw: [{ id }],
      }),
    });

    beforeEach(() => {
      messageRepo.findOne.mockResolvedValue({
        id: messageId,
        content: sentence,
        conversationId: 'conv-uuid',
        conversation: { id: 'conv-uuid', userId, type: AiConversationType.AUTHENTICATED },
      });
      vocabularyRepo.createQueryBuilder.mockReturnValue(mockUpsertChain('vocab-uuid'));
    });

    it('returns chunk with vocabularyId on success', async () => {
      llmService.chat.mockResolvedValue(JSON.stringify({
        text: '科技公司', type: 'compound_noun', from: 4, to: 8,
        translation: 'công ty công nghệ', pronunciation: 'kējì gōngsī',
      }));
      const r = await service.translateChunk(messageId, 'zh', 'vi', 4, 5, userId);
      expect(r.text).toBe('科技公司');
      expect(r.type).toBe('compound_noun');
      expect(r.pronunciation).toBe('kējì gōngsī');
      expect(r.vocabularyId).toBe('vocab-uuid');
    });

    it('throws 404 when message not found', async () => {
      messageRepo.findOne.mockResolvedValue(null);
      await expect(service.translateChunk(messageId, 'zh', 'vi', 0, 1, userId))
        .rejects.toThrow(NotFoundException);
    });

    it('throws 403 when caller is not owner', async () => {
      messageRepo.findOne.mockResolvedValue({
        id: messageId, content: sentence, conversationId: 'c',
        conversation: { id: 'c', userId: 'other-user', type: AiConversationType.AUTHENTICATED },
      });
      await expect(service.translateChunk(messageId, 'zh', 'vi', 0, 1, userId))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws 400 on invalid tap range (from >= to)', async () => {
      await expect(service.translateChunk(messageId, 'zh', 'vi', 5, 5, userId))
        .rejects.toThrow(BadRequestException);
    });

    it('throws 400 on invalid tap range (negative from)', async () => {
      await expect(service.translateChunk(messageId, 'zh', 'vi', -1, 2, userId))
        .rejects.toThrow(BadRequestException);
    });

    it('throws 400 when tapTo exceeds sentence length', async () => {
      await expect(service.translateChunk(messageId, 'zh', 'vi', 0, 999, userId))
        .rejects.toThrow(BadRequestException);
    });

    it('defaults to word type when LLM returns invalid type', async () => {
      llmService.chat.mockResolvedValue(JSON.stringify({
        text: '科技', type: 'NONSENSE', from: 4, to: 6,
        translation: 'tech', pronunciation: 'kējì',
      }));
      const r = await service.translateChunk(messageId, 'zh', 'vi', 4, 5, userId);
      expect(r.type).toBe('word');
    });

    it('clamps out-of-bounds from/to returned by LLM', async () => {
      llmService.chat.mockResolvedValue(JSON.stringify({
        text: '科技', type: 'word', from: -5, to: 9999,
        translation: 'tech', pronunciation: 'kējì',
      }));
      const r = await service.translateChunk(messageId, 'zh', 'vi', 4, 5, userId);
      expect(r.from).toBe(4);
      expect(r.to).toBe(5);
    });

    it('handles code-fenced JSON response', async () => {
      llmService.chat.mockResolvedValue(
        '```json\n{"text":"科技","type":"word","from":4,"to":6,"translation":"tech","pronunciation":"kējì"}\n```',
      );
      const r = await service.translateChunk(messageId, 'zh', 'vi', 4, 5, userId);
      expect(r.text).toBe('科技');
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
