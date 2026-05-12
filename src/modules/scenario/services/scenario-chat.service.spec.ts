jest.mock('../../ai/services/unified-llm.service');
jest.mock('../../ai/services/prompt-loader.service');

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ScenarioChatService } from './scenario-chat.service';
import { ScenarioAccessService } from './scenario-access.service';
import { AiConversation, AiConversationMessage, MessageRole, User, VocabularyInjectionEvent } from '../../../database/entities';
import { AiConversationType, ScenarioChatStatus } from '../../../database/entities/ai-conversation.entity';
import { PersonalizationTriggerService } from '../../personalization/services/personalization-trigger.service';
import { UnifiedLLMService } from '../../ai/services/unified-llm.service';
import { PromptLoaderService } from '../../ai/services/prompt-loader.service';
import { LanguageService } from '../../language/language.service';
import { VocabularyInjectionService } from './vocabulary-injection.service';
import { VocabularyReviewService } from '../../vocabulary/services/vocabulary-review.service';

const mockConvoRepo = () => {
  // Unified query-builder mock for `createQueryBuilder('c')` selects.
  const mockQb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
  };
  return {
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    create: jest.fn((dto) => dto),
    save: jest.fn((entity) => Promise.resolve({ ...entity, id: 'convo-uuid' })),
    findOne: jest.fn(),
    find: jest.fn(),
  };
};

const mockMsgRepo = () => ({
  create: jest.fn((dto) => dto),
  save: jest.fn((entity) => Promise.resolve({ ...entity, id: 'msg-uuid' })),
  find: jest.fn(),
});

const mockEventsRepo = () => ({
  create: jest.fn((dto) => dto),
  save: jest.fn(() => Promise.resolve([])),
});

const mockUserRepo = () => ({
  findOne: jest.fn().mockResolvedValue({ id: 'user-1', displayName: 'Alice' }),
});

const mockVocabInjectionService = () => ({
  selectVocabularyForConversation: jest.fn().mockResolvedValue([]),
  hydrateByIds: jest.fn().mockResolvedValue([]),
});

const mockVocabReviewService = () => ({
  touchReviewed: jest.fn().mockResolvedValue(undefined),
});

const mockLanguageService = () => ({
  getUserLanguages: jest.fn(),
  getNativeLanguage: jest.fn(),
});

const mockScenarioAccessService = () => ({
  findAccessibleScenario: jest.fn(),
});

describe('ScenarioChatService', () => {
  let module: TestingModule;
  let service: ScenarioChatService;
  let convoRepo: ReturnType<typeof mockConvoRepo>;
  let msgRepo: ReturnType<typeof mockMsgRepo>;
  let llmService: any;
  let promptLoader: any;
  let languageService: ReturnType<typeof mockLanguageService>;
  let scenarioAccessService: ReturnType<typeof mockScenarioAccessService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      providers: [
        ScenarioChatService,
        { provide: getRepositoryToken(AiConversation), useFactory: mockConvoRepo },
        { provide: getRepositoryToken(AiConversationMessage), useFactory: mockMsgRepo },
        { provide: getRepositoryToken(VocabularyInjectionEvent), useFactory: mockEventsRepo },
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
        { provide: PersonalizationTriggerService, useValue: { maybeTrigger: jest.fn().mockResolvedValue(undefined) } },
        { provide: UnifiedLLMService, useValue: { chat: jest.fn() } },
        { provide: PromptLoaderService, useValue: { loadPrompt: jest.fn() } },
        { provide: LanguageService, useFactory: mockLanguageService },
        { provide: ScenarioAccessService, useFactory: mockScenarioAccessService },
        { provide: VocabularyInjectionService, useFactory: mockVocabInjectionService },
        { provide: VocabularyReviewService, useFactory: mockVocabReviewService },
      ],
    }).compile();

    service = module.get<ScenarioChatService>(ScenarioChatService);
    convoRepo = module.get(getRepositoryToken(AiConversation));
    msgRepo = module.get(getRepositoryToken(AiConversationMessage));
    llmService = module.get(UnifiedLLMService);
    promptLoader = module.get(PromptLoaderService);
    languageService = module.get(LanguageService);
    scenarioAccessService = module.get(ScenarioAccessService);
  });

  const mockUserId = 'user-uuid-1';
  const mockScenarioId = 'scenario-uuid-1';
  const mockLanguageId = 'lang-uuid-1';
  const mockConversationId = 'convo-uuid-1';

  const mockScenario = {
    id: mockScenarioId,
    title: 'Restaurant Ordering',
    description: 'Learn how to order at a restaurant',
    languageId: mockLanguageId,
    category: { id: 'cat-id', name: 'Restaurant' },
  };

  const mockLanguage = {
    id: 'lang-uuid-1',
    code: 'en',
    name: 'English',
  };

  const mockUserLanguage = {
    id: 'user-lang-uuid-1',
    language: mockLanguage,
    isActive: true,
    proficiencyLevel: 'intermediate',
  };

  const mockNativeLanguage = {
    id: 'native-lang-uuid',
    code: 'fr',
    name: 'French',
  };

  const mockConversationEntity = {
    id: mockConversationId,
    userId: mockUserId,
    scenarioId: mockScenarioId,
    languageId: mockLanguageId,
    type: AiConversationType.AUTHENTICATED,
    topic: 'scenario_roleplay',
    messageCount: 0,
    status: ScenarioChatStatus.CHATTING,
    maxTurns: 12,
    injectedVocabIds: null,
  };

  describe('chat - new conversation', () => {
    it('should handle new conversation with empty message (AI opening)', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue(mockConversationEntity);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('formatted system prompt');
      llmService.chat.mockResolvedValue('{"reply":"Welcome to the restaurant!","is_end":false}');

      const dto = { scenarioId: mockScenarioId };
      const result = await service.chat(mockUserId, dto, 'lang-en');

      expect(scenarioAccessService.findAccessibleScenario).toHaveBeenCalledWith(mockUserId, mockScenarioId, 'lang-en');
      expect(result.scenario.conversation_id).toBe(mockConversationId);
      expect(result.scenario.turn).toBe(0);
      expect(result.scenario.max_turns).toBe(12);
      expect(result.scenario.status).toBe(ScenarioChatStatus.CHATTING);
      expect(Array.isArray(result.messages)).toBe(true);
    });

    it('should create new conversation with message and persist both messages', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue(mockConversationEntity);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('formatted system prompt');
      llmService.chat.mockResolvedValue('{"reply":"A table for two?","is_end":false}');

      const dto = { scenarioId: mockScenarioId, message: 'Hi, I want to order' };
      const result = await service.chat(mockUserId, dto, 'lang-en');

      expect(msgRepo.save).toHaveBeenCalledTimes(2);
      expect(msgRepo.save).toHaveBeenNthCalledWith(1, expect.objectContaining({ role: MessageRole.USER }));
      expect(msgRepo.save).toHaveBeenNthCalledWith(2, expect.objectContaining({ role: MessageRole.ASSISTANT }));
      expect(result.scenario).toBeDefined();
    });

    it('should load and pass scenario context to prompt', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue(mockConversationEntity);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('{"reply":"reply","is_end":false}');

      const dto = { scenarioId: mockScenarioId };
      await service.chat(mockUserId, dto, 'lang-en');

      expect(promptLoader.loadPrompt).toHaveBeenCalledWith(
        'scenario-chat-prompt.json',
        expect.objectContaining({
          scenarioTitle: 'Restaurant Ordering',
          scenarioDescription: 'Learn how to order at a restaurant',
          scenarioCategory: 'Restaurant',
          targetLanguage: 'English',
          nativeLanguage: 'French',
          proficiencyLevel: 'intermediate',
          currentTurn: '1',
          maxTurns: '12',
          status: 'opening',
          learnerName: 'Alice',
        }),
      );
    });
  });

  describe('chat - resume conversation', () => {
    it('should resume existing conversation by conversationId', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      convoRepo.findOne.mockResolvedValue(mockConversationEntity);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('{"reply":"Continuing the conversation","is_end":false}');
      convoRepo.save.mockResolvedValue(mockConversationEntity);

      const dto = { scenarioId: mockScenarioId, conversationId: mockConversationId, message: 'Next turn' };
      const result = await service.chat(mockUserId, dto, 'lang-en');

      expect(convoRepo.findOne).toHaveBeenCalledWith({ where: { id: mockConversationId } });
      expect(result.scenario.conversation_id).toBe(mockConversationId);
    });

    it('should throw ForbiddenException when userId mismatch on resume', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      const otherUserConversation = { ...mockConversationEntity, userId: 'other-user-id' };
      convoRepo.findOne.mockResolvedValue(otherUserConversation);

      const dto = { scenarioId: mockScenarioId, conversationId: mockConversationId };
      await expect(service.chat(mockUserId, dto, 'lang-en')).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when scenarioId mismatch on resume', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      const wrongScenarioConvo = { ...mockConversationEntity, scenarioId: 'other-scenario-id' };
      convoRepo.findOne.mockResolvedValue(wrongScenarioConvo);

      const dto = { scenarioId: mockScenarioId, conversationId: mockConversationId };
      await expect(service.chat(mockUserId, dto, 'lang-en')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when conversation not found', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      convoRepo.findOne.mockResolvedValue(null);

      const dto = { scenarioId: mockScenarioId, conversationId: 'non-existent-convo' };
      await expect(service.chat(mockUserId, dto, 'lang-en')).rejects.toThrow(NotFoundException);
    });
  });

  describe('chat - completion and turn tracking', () => {
    it('should return the existing transcript with status DONE when supplied conversationId is DONE', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);

      const completedConvo = { ...mockConversationEntity, status: ScenarioChatStatus.DONE };
      convoRepo.findOne.mockResolvedValue(completedConvo);
      msgRepo.find.mockResolvedValue([]);

      const dto = { scenarioId: mockScenarioId, conversationId: mockConversationId };
      const result = await service.chat(mockUserId, dto, 'lang-en');

      expect(result.scenario.conversation_id).toBe(mockConversationId);
      expect(result.scenario.status).toBe(ScenarioChatStatus.DONE);
      // DONE short-circuit: no LLM call, no state mutation
      expect(llmService.chat).not.toHaveBeenCalled();
      expect(convoRepo.save).not.toHaveBeenCalled();
    });

    it('should set status=DONE when turn reaches maxTurns (hard-end at turn 12)', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);

      // 22 messages = 11 completed turns (11 user + 11 assistant)
      const now = new Date();
      const historyWith22Messages = Array.from({ length: 22 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? MessageRole.USER : MessageRole.ASSISTANT,
        content: `Message ${i}`,
        createdAt: now,
      }));

      const newConvo = { ...mockConversationEntity, messageCount: 22, status: ScenarioChatStatus.CHATTING, maxTurns: 12 };
      convoRepo.save.mockResolvedValue(newConvo);
      // First call: loadHistory; second call: transcript re-query after save
      msgRepo.find
        .mockResolvedValueOnce(historyWith22Messages)
        .mockResolvedValue(historyWith22Messages);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('{"reply":"Turn 12 reply","is_end":false}');

      const dto = { scenarioId: mockScenarioId, message: 'Final turn' };
      const result = await service.chat(mockUserId, dto, 'lang-en');

      expect(result.scenario.turn).toBe(12);
      expect(result.scenario.status).toBe(ScenarioChatStatus.DONE);
      const savedCall = convoRepo.save.mock.calls[convoRepo.save.mock.calls.length - 1][0];
      expect(savedCall.status).toBe(ScenarioChatStatus.DONE);
    });

    it('should remain CHATTING before max turns', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);

      // 2 messages = 1 completed turn
      const now = new Date();
      const historyWith2Messages = [
        { id: 'msg-0', role: MessageRole.USER, content: 'Message 0', createdAt: now },
        { id: 'msg-1', role: MessageRole.ASSISTANT, content: 'Message 1', createdAt: now },
      ];

      const newConvo = { ...mockConversationEntity, messageCount: 2, status: ScenarioChatStatus.CHATTING, maxTurns: 12 };
      convoRepo.save.mockResolvedValue(newConvo);
      // First call: loadHistory; second call: transcript re-query after save
      msgRepo.find
        .mockResolvedValueOnce(historyWith2Messages)
        .mockResolvedValue(historyWith2Messages);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('{"reply":"Turn 2 reply","is_end":false}');

      const dto = { scenarioId: mockScenarioId, message: 'Turn 2' };
      const result = await service.chat(mockUserId, dto, 'lang-en');

      expect(result.scenario.turn).toBe(2);
      expect(result.scenario.status).toBe(ScenarioChatStatus.CHATTING);
    });

    it('should set status=DONE on soft-end (LLM is_end=true) before maxTurns', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);

      const newConvo = { ...mockConversationEntity, messageCount: 4, status: ScenarioChatStatus.CHATTING, maxTurns: 12 };
      convoRepo.save.mockResolvedValue(newConvo);
      msgRepo.find
        .mockResolvedValueOnce([
          { role: MessageRole.USER, content: 'hi', createdAt: new Date() },
          { role: MessageRole.ASSISTANT, content: 'hello', createdAt: new Date() },
          { role: MessageRole.USER, content: 'thanks', createdAt: new Date() },
          { role: MessageRole.ASSISTANT, content: 'sure', createdAt: new Date() },
        ])
        .mockResolvedValue([]);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('{"reply":"Goodbye!","is_end":true}');

      const dto = { scenarioId: mockScenarioId, message: 'bye' };
      const result = await service.chat(mockUserId, dto, 'lang-en');

      expect(result.scenario.status).toBe(ScenarioChatStatus.DONE);
      const savedCall = convoRepo.save.mock.calls[convoRepo.save.mock.calls.length - 1][0];
      expect(savedCall.status).toBe(ScenarioChatStatus.DONE);
    });
  });

  describe('chat - language context', () => {
    it('should throw BadRequestException when user has no active learning language', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([]);

      const dto = { scenarioId: mockScenarioId };
      await expect(service.chat(mockUserId, dto, 'lang-en')).rejects.toThrow(BadRequestException);
    });

    it('should use first language when no active language', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      const inactiveUserLang = { ...mockUserLanguage, isActive: false };
      languageService.getUserLanguages.mockResolvedValue([inactiveUserLang]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue(mockConversationEntity);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('{"reply":"reply","is_end":false}');

      const dto = { scenarioId: mockScenarioId };
      await service.chat(mockUserId, dto, 'lang-en');

      expect(promptLoader.loadPrompt).toHaveBeenCalledWith(
        'scenario-chat-prompt.json',
        expect.objectContaining({
          targetLanguage: mockLanguage.name,
        }),
      );
    });

    it('should default nativeLanguage to English when user has no native language set', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(null);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue(mockConversationEntity);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('{"reply":"reply","is_end":false}');

      const dto = { scenarioId: mockScenarioId };
      await service.chat(mockUserId, dto, 'lang-en');

      expect(promptLoader.loadPrompt).toHaveBeenCalledWith(
        'scenario-chat-prompt.json',
        expect.objectContaining({
          nativeLanguage: 'English',
        }),
      );
    });

    // Regression: X-Learning-Language header must drive prompt's targetLanguage,
    // NOT the user's stored isActive flag. Bug surfaced when stored active=English
    // but request sent X-Learning-Language: zh — AI replied in English.
    it('should use language from request (header), not user.isActive flag', async () => {
      jest.clearAllMocks();
      const enLang = { id: 'lang-en', code: 'en', name: 'English' };
      const zhLang = { id: 'lang-zh', code: 'zh', name: 'Chinese' };
      const enUserLang = {
        id: 'ul-en',
        languageId: 'lang-en',
        language: enLang,
        isActive: true,
        proficiencyLevel: 'intermediate',
      };
      const zhUserLang = {
        id: 'ul-zh',
        languageId: 'lang-zh',
        language: zhLang,
        isActive: false,
        proficiencyLevel: 'beginner',
      };

      scenarioAccessService.findAccessibleScenario.mockResolvedValue({
        ...mockScenario,
        languageId: 'lang-zh',
      });
      languageService.getUserLanguages.mockResolvedValue([enUserLang, zhUserLang]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue({ ...mockConversationEntity, languageId: 'lang-zh' });
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('{"reply":"reply","is_end":false}');

      const dto = { scenarioId: mockScenarioId };
      await service.chat(mockUserId, dto, 'lang-zh');

      expect(promptLoader.loadPrompt).toHaveBeenCalledWith(
        'scenario-chat-prompt.json',
        expect.objectContaining({
          targetLanguage: 'Chinese',
          proficiencyLevel: 'beginner',
        }),
      );
    });
  });

  describe('chat - message persistence', () => {
    it('should persist user message and assistant reply', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue(mockConversationEntity);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('{"reply":"AI reply","is_end":false}');

      const userMessage = 'I want to order now';
      const dto = { scenarioId: mockScenarioId, message: userMessage };
      await service.chat(mockUserId, dto, 'lang-en');

      expect(msgRepo.save).toHaveBeenCalledTimes(2);
      expect(msgRepo.create).toHaveBeenNthCalledWith(1, {
        conversationId: mockConversationId,
        role: MessageRole.USER,
        content: userMessage,
      });
      expect(msgRepo.create).toHaveBeenNthCalledWith(2, {
        conversationId: mockConversationId,
        role: MessageRole.ASSISTANT,
        content: 'AI reply',
      });
    });

    it('should not persist user message when message is empty', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue(mockConversationEntity);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('{"reply":"AI opening","is_end":false}');

      const dto = { scenarioId: mockScenarioId };
      await service.chat(mockUserId, dto, 'lang-en');

      expect(msgRepo.save).toHaveBeenCalledTimes(1);
      expect(msgRepo.create).toHaveBeenCalledWith({
        conversationId: mockConversationId,
        role: MessageRole.ASSISTANT,
        content: 'AI opening',
      });
    });

    it('should increment messageCount correctly', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      const convoWithCount = { ...mockConversationEntity, messageCount: 5 };
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue(convoWithCount);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('{"reply":"reply","is_end":false}');

      const dto = { scenarioId: mockScenarioId, message: 'Hello' };
      await service.chat(mockUserId, dto, 'lang-en');

      expect(convoRepo.save).toHaveBeenCalledWith(expect.objectContaining({ messageCount: 7 }));
    });
  });

  describe('listConversations', () => {
    it('should return owner-filtered conversations newest first', async () => {
      const now = new Date('2026-04-14T10:00:00Z');
      const earlier = new Date('2026-04-13T10:00:00Z');
      convoRepo.find.mockResolvedValue([
        {
          id: 'convo-a',
          createdAt: now,
          updatedAt: now,
          messageCount: 24,
          status: ScenarioChatStatus.DONE,
          maxTurns: 12,
        },
        {
          id: 'convo-b',
          createdAt: earlier,
          updatedAt: earlier,
          messageCount: 6,
          status: ScenarioChatStatus.CHATTING,
          maxTurns: 12,
        },
      ]);

      const result = await service.listConversations(mockUserId, mockScenarioId);

      expect(convoRepo.find).toHaveBeenCalledWith({
        where: { userId: mockUserId, scenarioId: mockScenarioId },
        order: { createdAt: 'DESC' },
      });
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        id: 'convo-a',
        startedAt: now.toISOString(),
        lastTurnAt: now.toISOString(),
        turnCount: 12,
        status: ScenarioChatStatus.DONE,
        maxTurns: 12,
      });
      expect(result.items[1].turnCount).toBe(3);
      expect(result.items[1].status).toBe(ScenarioChatStatus.CHATTING);
    });

    it('should return empty list when user has no conversations', async () => {
      convoRepo.find.mockResolvedValue([]);
      const result = await service.listConversations(mockUserId, mockScenarioId);
      expect(result).toEqual({ items: [] });
    });

    it('should default maxTurns when column is missing', async () => {
      convoRepo.find.mockResolvedValue([
        {
          id: 'convo-a',
          createdAt: new Date(),
          updatedAt: new Date(),
          messageCount: 0,
          status: ScenarioChatStatus.CHATTING,
          maxTurns: null,
        },
      ]);
      const result = await service.listConversations(mockUserId, mockScenarioId);
      expect(result.items[0].maxTurns).toBe(12);
      expect(result.items[0].status).toBe(ScenarioChatStatus.CHATTING);
    });
  });

  describe('getConversation', () => {
    it('should return transcript for the owner', async () => {
      const created = new Date('2026-04-14T09:00:00Z');
      convoRepo.findOne.mockResolvedValue({
        id: mockConversationId,
        userId: mockUserId,
        scenarioId: mockScenarioId,
        messageCount: 2,
        status: ScenarioChatStatus.CHATTING,
        maxTurns: 12,
      });
      msgRepo.find.mockResolvedValue([
        { id: 'msg-1', role: MessageRole.USER, content: 'hello', createdAt: created },
        { id: 'msg-2', role: MessageRole.ASSISTANT, content: 'hi', createdAt: created },
      ]);

      const result = await service.getConversation(mockUserId, mockConversationId);

      expect(result).toEqual({
        scenario: {
          conversation_id: mockConversationId,
          max_turns: 12,
          turn: 1,
          status: ScenarioChatStatus.CHATTING,
        },
        messages: [
          { id: 'msg-1', role: 'user', content: 'hello', created_at: created.toISOString() },
          { id: 'msg-2', role: 'assistant', content: 'hi', created_at: created.toISOString() },
        ],
      });
    });

    it('should filter out system-role messages from the transcript', async () => {
      convoRepo.findOne.mockResolvedValue({
        id: mockConversationId,
        userId: mockUserId,
        scenarioId: mockScenarioId,
        messageCount: 2,
        status: ScenarioChatStatus.CHATTING,
        maxTurns: 12,
      });
      msgRepo.find.mockResolvedValue([
        { id: 'sys-1', role: MessageRole.SYSTEM, content: 'sys', createdAt: new Date() },
        { id: 'msg-1', role: MessageRole.USER, content: 'hi', createdAt: new Date() },
      ]);
      const result = await service.getConversation(mockUserId, mockConversationId);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
    });

    it('should throw NotFoundException when conversation is missing', async () => {
      convoRepo.findOne.mockResolvedValue(null);
      await expect(service.getConversation(mockUserId, mockConversationId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when caller is not the owner', async () => {
      convoRepo.findOne.mockResolvedValue({
        id: mockConversationId,
        userId: 'other-user',
        scenarioId: mockScenarioId,
        messageCount: 0,
        status: ScenarioChatStatus.CHATTING,
        maxTurns: 12,
      });
      await expect(service.getConversation(mockUserId, mockConversationId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('chat - LLM interaction', () => {
    it('should pass correct metadata to LLM service', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue(mockConversationEntity);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('{"reply":"reply","is_end":false}');

      const dto = { scenarioId: mockScenarioId, message: 'Hello' };
      await service.chat(mockUserId, dto, 'lang-en');

      expect(llmService.chat).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          metadata: expect.objectContaining({
            feature: 'scenario-chat',
            userId: mockUserId,
            conversationId: mockConversationId,
            turn: 1,
            scenarioId: mockScenarioId,
          }),
        }),
      );
    });

    it('should include system prompt and user message in LLM call', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue(mockConversationEntity);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('system prompt text');
      llmService.chat.mockResolvedValue('{"reply":"reply","is_end":false}');

      const dto = { scenarioId: mockScenarioId, message: 'User message' };
      await service.chat(mockUserId, dto, 'lang-en');

      const callArgs = llmService.chat.mock.calls[0][0];
      expect(callArgs).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: 'system prompt text' }),
        expect.objectContaining({ text: 'User message' }),
      ]));
    });
  });

  describe('chat - vocab injection', () => {
    let vocabInjection: ReturnType<typeof mockVocabInjectionService>;
    let eventsRepo: ReturnType<typeof mockEventsRepo>;
    let vocabReview: ReturnType<typeof mockVocabReviewService>;

    const setupChat = (convOverrides = {}) => {
      const conv = { ...mockConversationEntity, ...convOverrides };
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue(conv);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('{"reply":"reply","is_end":false}');
      return conv;
    };

    beforeEach(() => {
      vocabInjection = module.get(VocabularyInjectionService);
      eventsRepo = module.get(getRepositoryToken(VocabularyInjectionEvent));
      vocabReview = module.get(VocabularyReviewService);
    });

    it('turn-1 (injectedVocabIds=null) → calls selectVocabularyForConversation and persists IDs', async () => {
      const mockVocab = [{ id: 'v1', word: 'bonjour', translation: 'hello', box: 2 }] as any[];
      vocabInjection.selectVocabularyForConversation.mockResolvedValue(mockVocab);
      setupChat({ injectedVocabIds: null });

      const dto = { scenarioId: mockScenarioId };
      await service.chat(mockUserId, dto, 'lang-en');

      expect(vocabInjection.selectVocabularyForConversation).toHaveBeenCalledWith(mockUserId, 'en');
      expect(vocabInjection.hydrateByIds).not.toHaveBeenCalled();
      // IDs should be persisted on conversation
      const savedCalls = convoRepo.save.mock.calls;
      const savedConv = savedCalls.find((c: any[]) => Array.isArray(c[0]?.injectedVocabIds) || c[0]?.injectedVocabIds !== undefined);
      expect(savedConv).toBeDefined();
    });

    it('turn-2 (injectedVocabIds cached) → calls hydrateByIds, skips selectVocabularyForConversation', async () => {
      const cachedIds = ['v1', 'v2'];
      vocabInjection.hydrateByIds.mockResolvedValue([]);
      setupChat({ injectedVocabIds: cachedIds });

      const dto = { scenarioId: mockScenarioId };
      await service.chat(mockUserId, dto, 'lang-en');

      expect(vocabInjection.hydrateByIds).toHaveBeenCalledWith(cachedIds);
      expect(vocabInjection.selectVocabularyForConversation).not.toHaveBeenCalled();
    });

    it('turn-1 selection throws → conversation saves with injectedVocabIds=[], response still returns', async () => {
      vocabInjection.selectVocabularyForConversation.mockRejectedValue(new Error('DB timeout'));
      setupChat({ injectedVocabIds: null });

      const dto = { scenarioId: mockScenarioId };
      const result = await service.chat(mockUserId, dto, 'lang-en');

      expect(result.scenario).toBeDefined();
      const saveCalls = convoRepo.save.mock.calls;
      const errorSave = saveCalls.find((c: any[]) => Array.isArray(c[0]?.injectedVocabIds) && c[0].injectedVocabIds.length === 0);
      expect(errorSave).toBeDefined();
    });

    it('user message contains injected word → event row wasUsed=true, touchReviewed called', async () => {
      const mockVocab = [{ id: 'v1', word: 'bonjour', translation: 'hello', box: 1 }] as any[];
      setupChat({ injectedVocabIds: ['v1'] });
      vocabInjection.hydrateByIds.mockResolvedValue(mockVocab);

      const dto = { scenarioId: mockScenarioId, message: 'Bonjour! How are you?' };
      await service.chat(mockUserId, dto, 'lang-en');

      // Allow fire-and-forget to settle
      await new Promise((r) => setImmediate(r));

      expect(eventsRepo.create).toHaveBeenCalledWith(expect.objectContaining({ wasUsed: true }));
      expect(vocabReview.touchReviewed).toHaveBeenCalledWith(mockUserId, 'v1');
    });

    it('user message no match → event rows all wasUsed=false, touchReviewed NOT called', async () => {
      const mockVocab = [{ id: 'v1', word: 'merci', translation: 'thanks', box: 1 }] as any[];
      setupChat({ injectedVocabIds: ['v1'] });
      vocabInjection.hydrateByIds.mockResolvedValue(mockVocab);

      const dto = { scenarioId: mockScenarioId, message: 'Hello there' };
      await service.chat(mockUserId, dto, 'lang-en');

      await new Promise((r) => setImmediate(r));

      expect(eventsRepo.create).toHaveBeenCalledWith(expect.objectContaining({ wasUsed: false }));
      expect(vocabReview.touchReviewed).not.toHaveBeenCalled();
    });

    it('empty dto.message → trackUsage early-returns, no event rows', async () => {
      const mockVocab = [{ id: 'v1', word: 'bonjour', translation: 'hello', box: 1 }] as any[];
      setupChat({ injectedVocabIds: ['v1'] });
      vocabInjection.hydrateByIds.mockResolvedValue(mockVocab);

      const dto = { scenarioId: mockScenarioId }; // no message
      await service.chat(mockUserId, dto, 'lang-en');

      await new Promise((r) => setImmediate(r));

      expect(eventsRepo.save).not.toHaveBeenCalled();
    });
  });
});
