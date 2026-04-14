jest.mock('../../ai/services/unified-llm.service');
jest.mock('../../ai/services/prompt-loader.service');

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ScenarioChatService } from './scenario-chat.service';
import { ScenarioAccessService } from './scenario-access.service';
import { AiConversation, AiConversationMessage, MessageRole } from '../../../database/entities';
import { AiConversationType } from '../../../database/entities/ai-conversation.entity';
import { UnifiedLLMService } from '../../ai/services/unified-llm.service';
import { PromptLoaderService } from '../../ai/services/prompt-loader.service';
import { LanguageService } from '../../language/language.service';

const mockConvoRepo = () => {
  // Single unified query-builder mock covering both select and update paths
  // (service uses `createQueryBuilder('c')` for selects and
  // `createQueryBuilder()` for the forceNew update — both resolve here).
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

const mockLanguageService = () => ({
  getUserLanguages: jest.fn(),
  getNativeLanguage: jest.fn(),
});

const mockScenarioAccessService = () => ({
  findAccessibleScenario: jest.fn(),
});

describe('ScenarioChatService', () => {
  let service: ScenarioChatService;
  let convoRepo: ReturnType<typeof mockConvoRepo>;
  let msgRepo: ReturnType<typeof mockMsgRepo>;
  let llmService: any;
  let promptLoader: any;
  let languageService: ReturnType<typeof mockLanguageService>;
  let scenarioAccessService: ReturnType<typeof mockScenarioAccessService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioChatService,
        { provide: getRepositoryToken(AiConversation), useFactory: mockConvoRepo },
        { provide: getRepositoryToken(AiConversationMessage), useFactory: mockMsgRepo },
        { provide: UnifiedLLMService, useValue: { chat: jest.fn() } },
        { provide: PromptLoaderService, useValue: { loadPrompt: jest.fn() } },
        { provide: LanguageService, useFactory: mockLanguageService },
        { provide: ScenarioAccessService, useFactory: mockScenarioAccessService },
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
    metadata: { maxTurns: 12, completed: false },
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
      llmService.chat.mockResolvedValue('Welcome to the restaurant!');

      const dto = { scenarioId: mockScenarioId };
      const result = await service.chat(mockUserId, dto);

      expect(scenarioAccessService.findAccessibleScenario).toHaveBeenCalledWith(mockUserId, mockScenarioId);
      expect(result).toEqual({
        reply: 'Welcome to the restaurant!',
        conversationId: mockConversationId,
        turn: 1,
        maxTurns: 12,
        completed: false,
      });
    });

    it('should create new conversation with message and persist both messages', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue(mockConversationEntity);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('formatted system prompt');
      llmService.chat.mockResolvedValue('A table for two?');

      const dto = { scenarioId: mockScenarioId, message: 'Hi, I want to order' };
      const result = await service.chat(mockUserId, dto);

      expect(msgRepo.save).toHaveBeenCalledTimes(2);
      expect(msgRepo.save).toHaveBeenNthCalledWith(1, expect.objectContaining({ role: MessageRole.USER }));
      expect(msgRepo.save).toHaveBeenNthCalledWith(2, expect.objectContaining({ role: MessageRole.ASSISTANT }));
      expect(result.reply).toBe('A table for two?');
    });

    it('should load and pass scenario context to prompt', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue(mockConversationEntity);
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('reply');

      const dto = { scenarioId: mockScenarioId };
      await service.chat(mockUserId, dto);

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
          isOpening: 'true',
          isWrapUp: 'false',
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
      llmService.chat.mockResolvedValue('Continuing the conversation');
      convoRepo.save.mockResolvedValue(mockConversationEntity);

      const dto = { scenarioId: mockScenarioId, conversationId: mockConversationId, message: 'Next turn' };
      const result = await service.chat(mockUserId, dto);

      expect(convoRepo.findOne).toHaveBeenCalledWith({ where: { id: mockConversationId } });
      expect(result.conversationId).toBe(mockConversationId);
    });

    it('should throw ForbiddenException when userId mismatch on resume', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      const otherUserConversation = { ...mockConversationEntity, userId: 'other-user-id' };
      convoRepo.findOne.mockResolvedValue(otherUserConversation);

      const dto = { scenarioId: mockScenarioId, conversationId: mockConversationId };
      await expect(service.chat(mockUserId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when scenarioId mismatch on resume', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      const wrongScenarioConvo = { ...mockConversationEntity, scenarioId: 'other-scenario-id' };
      convoRepo.findOne.mockResolvedValue(wrongScenarioConvo);

      const dto = { scenarioId: mockScenarioId, conversationId: mockConversationId };
      await expect(service.chat(mockUserId, dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when conversation not found', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      convoRepo.findOne.mockResolvedValue(null);

      const dto = { scenarioId: mockScenarioId, conversationId: 'non-existent-convo' };
      await expect(service.chat(mockUserId, dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('chat - completion and turn tracking', () => {
    it('should throw BadRequestException when conversation already completed', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      const completedConvo = { ...mockConversationEntity, metadata: { completed: true } };
      convoRepo.findOne.mockResolvedValue(completedConvo);

      const dto = { scenarioId: mockScenarioId, conversationId: mockConversationId };
      await expect(service.chat(mockUserId, dto)).rejects.toThrow(BadRequestException);
    });

    it('should set completed=true when currentTurn >= maxTurns (turn 12)', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);

      // 22 messages = 11 completed turns (11 user + 11 assistant)
      const historyWith22Messages = Array.from({ length: 22 }, (_, i) => ({
        role: i % 2 === 0 ? MessageRole.USER : MessageRole.ASSISTANT,
        content: `Message ${i}`,
      }));

      const newConvo = { ...mockConversationEntity, messageCount: 22, metadata: { maxTurns: 12, completed: false } };
      convoRepo.save.mockResolvedValue(newConvo);
      msgRepo.find.mockResolvedValue(historyWith22Messages);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('Turn 12 reply');

      const dto = { scenarioId: mockScenarioId, message: 'Final turn' };
      const result = await service.chat(mockUserId, dto);

      expect(result.turn).toBe(12);
      expect(result.completed).toBe(true);
      // Check that the saved convo has completed: true in metadata
      const savedCall = convoRepo.save.mock.calls[convoRepo.save.mock.calls.length - 1][0];
      expect(savedCall.metadata.completed).toBe(true);
    });

    it('should mark as not completed before max turns', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);

      // 2 messages = 1 completed turn
      const historyWith2Messages = [
        { role: MessageRole.USER, content: 'Message 0' },
        { role: MessageRole.ASSISTANT, content: 'Message 1' },
      ];

      const newConvo = { ...mockConversationEntity, messageCount: 2, metadata: { maxTurns: 12, completed: false } };
      convoRepo.save.mockResolvedValue(newConvo);
      msgRepo.find.mockResolvedValue(historyWith2Messages);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('Turn 2 reply');

      const dto = { scenarioId: mockScenarioId, message: 'Turn 2' };
      const result = await service.chat(mockUserId, dto);

      expect(result.turn).toBe(2);
      expect(result.completed).toBe(false);
    });
  });

  describe('chat - language context', () => {
    it('should throw BadRequestException when user has no active learning language', async () => {
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([]);

      const dto = { scenarioId: mockScenarioId };
      await expect(service.chat(mockUserId, dto)).rejects.toThrow(BadRequestException);
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
      llmService.chat.mockResolvedValue('reply');

      const dto = { scenarioId: mockScenarioId };
      await service.chat(mockUserId, dto);

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
      llmService.chat.mockResolvedValue('reply');

      const dto = { scenarioId: mockScenarioId };
      await service.chat(mockUserId, dto);

      expect(promptLoader.loadPrompt).toHaveBeenCalledWith(
        'scenario-chat-prompt.json',
        expect.objectContaining({
          nativeLanguage: 'English',
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
      llmService.chat.mockResolvedValue('AI reply');

      const userMessage = 'I want to order now';
      const dto = { scenarioId: mockScenarioId, message: userMessage };
      await service.chat(mockUserId, dto);

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
      llmService.chat.mockResolvedValue('AI opening');

      const dto = { scenarioId: mockScenarioId };
      await service.chat(mockUserId, dto);

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
      llmService.chat.mockResolvedValue('reply');

      const dto = { scenarioId: mockScenarioId, message: 'Hello' };
      await service.chat(mockUserId, dto);

      expect(convoRepo.save).toHaveBeenCalledWith(expect.objectContaining({ messageCount: 7 }));
    });
  });

  describe('chat - forceNew', () => {
    it('should reject when both forceNew and conversationId are provided', async () => {
      const dto = { scenarioId: mockScenarioId, conversationId: mockConversationId, forceNew: true };
      await expect(service.chat(mockUserId, dto)).rejects.toThrow(BadRequestException);
    });

    it('should mark active conversations as completed and create a fresh one', async () => {
      jest.clearAllMocks();
      scenarioAccessService.findAccessibleScenario.mockResolvedValue(mockScenario);
      languageService.getUserLanguages.mockResolvedValue([mockUserLanguage]);
      languageService.getNativeLanguage.mockResolvedValue(mockNativeLanguage);
      // After forceNew wipes the active flag, findOrCreate's select returns null → insert.
      convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
      convoRepo.save.mockResolvedValue({ ...mockConversationEntity, id: 'new-convo-uuid' });
      msgRepo.find.mockResolvedValue([]);
      promptLoader.loadPrompt.mockReturnValue('system prompt');
      llmService.chat.mockResolvedValue('Fresh opening');

      const dto = { scenarioId: mockScenarioId, forceNew: true };
      const result = await service.chat(mockUserId, dto);

      // The forceNew update chain should have fired.
      const qb = convoRepo.createQueryBuilder();
      expect(qb.update).toHaveBeenCalled();
      expect(qb.set).toHaveBeenCalled();
      expect(qb.execute).toHaveBeenCalled();
      expect(result.conversationId).toBe('new-convo-uuid');
      expect(result.turn).toBe(1);
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
          metadata: { completed: true, maxTurns: 12 },
        },
        {
          id: 'convo-b',
          createdAt: earlier,
          updatedAt: earlier,
          messageCount: 6,
          metadata: { completed: false, maxTurns: 12 },
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
        completed: true,
        maxTurns: 12,
      });
      expect(result.items[1].turnCount).toBe(3);
      expect(result.items[1].completed).toBe(false);
    });

    it('should return empty list when user has no conversations', async () => {
      convoRepo.find.mockResolvedValue([]);
      const result = await service.listConversations(mockUserId, mockScenarioId);
      expect(result).toEqual({ items: [] });
    });

    it('should default maxTurns when metadata missing', async () => {
      convoRepo.find.mockResolvedValue([
        {
          id: 'convo-a',
          createdAt: new Date(),
          updatedAt: new Date(),
          messageCount: 0,
          metadata: null,
        },
      ]);
      const result = await service.listConversations(mockUserId, mockScenarioId);
      expect(result.items[0].maxTurns).toBe(12);
      expect(result.items[0].completed).toBe(false);
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
        metadata: { completed: false, maxTurns: 12 },
      });
      msgRepo.find.mockResolvedValue([
        { role: MessageRole.USER, content: 'hello', createdAt: created },
        { role: MessageRole.ASSISTANT, content: 'hi', createdAt: created },
      ]);

      const result = await service.getConversation(mockUserId, mockConversationId);

      expect(result).toEqual({
        id: mockConversationId,
        scenarioId: mockScenarioId,
        completed: false,
        turn: 1,
        maxTurns: 12,
        messages: [
          { role: 'user', content: 'hello', createdAt: created.toISOString() },
          { role: 'assistant', content: 'hi', createdAt: created.toISOString() },
        ],
      });
    });

    it('should filter out system-role messages from the transcript', async () => {
      convoRepo.findOne.mockResolvedValue({
        id: mockConversationId,
        userId: mockUserId,
        scenarioId: mockScenarioId,
        messageCount: 2,
        metadata: {},
      });
      msgRepo.find.mockResolvedValue([
        { role: MessageRole.SYSTEM, content: 'sys', createdAt: new Date() },
        { role: MessageRole.USER, content: 'hi', createdAt: new Date() },
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
        metadata: {},
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
      llmService.chat.mockResolvedValue('reply');

      const dto = { scenarioId: mockScenarioId, message: 'Hello' };
      await service.chat(mockUserId, dto);

      expect(llmService.chat).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          metadata: expect.objectContaining({
            feature: 'scenario_chat',
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
      llmService.chat.mockResolvedValue('reply');

      const dto = { scenarioId: mockScenarioId, message: 'User message' };
      await service.chat(mockUserId, dto);

      const callArgs = llmService.chat.mock.calls[0][0];
      expect(callArgs).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: 'system prompt text' }),
        expect.objectContaining({ text: 'User message' }),
      ]));
    });
  });
});
