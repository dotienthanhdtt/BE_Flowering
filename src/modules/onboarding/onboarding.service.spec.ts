// Prevent loading unified-llm → openai-provider → langfuse chain (ESM dynamic import issue)
jest.mock('../ai/services/unified-llm.service', () => ({ UnifiedLLMService: class {} }));
jest.mock('../ai/services/prompt-loader.service', () => ({ PromptLoaderService: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { AiConversation, AiConversationMessage } from '../../database/entities';
import { AiConversationType } from '../../database/entities/ai-conversation.entity';
import { UnifiedLLMService } from '../ai/services/unified-llm.service';
import { PromptLoaderService } from '../ai/services/prompt-loader.service';
import { onboardingConfig } from './onboarding.config';

const mockConversationRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  increment: jest.fn(),
});

const mockMessageRepo = () => ({
  save: jest.fn(),
  find: jest.fn(),
});

const mockLLMService = () => ({
  chat: jest.fn(),
});

const mockPromptLoader = () => ({
  loadPrompt: jest.fn().mockReturnValue('system prompt'),
});

const makeConversation = (overrides: Partial<AiConversation> = {}): AiConversation =>
  ({
    id: 'conv-1',
    type: AiConversationType.ANONYMOUS,
    messageCount: 0,
    expiresAt: new Date(Date.now() + 86400000), // 1 day in future
    metadata: { nativeLanguage: 'English', targetLanguage: 'Spanish' },
    ...overrides,
  } as AiConversation);

describe('OnboardingService', () => {
  let service: OnboardingService;
  let conversationRepo: ReturnType<typeof mockConversationRepo>;
  let messageRepo: ReturnType<typeof mockMessageRepo>;
  let llmService: ReturnType<typeof mockLLMService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: getRepositoryToken(AiConversation), useFactory: mockConversationRepo },
        { provide: getRepositoryToken(AiConversationMessage), useFactory: mockMessageRepo },
        { provide: UnifiedLLMService, useFactory: mockLLMService },
        { provide: PromptLoaderService, useFactory: mockPromptLoader },
      ],
    }).compile();

    service = module.get(OnboardingService);
    conversationRepo = module.get(getRepositoryToken(AiConversation));
    messageRepo = module.get(getRepositoryToken(AiConversationMessage));
    llmService = module.get(UnifiedLLMService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('startSession', () => {
    it('creates conversation with correct fields and returns conversationId', async () => {
      const conversation = makeConversation({ id: 'conv-123' });
      conversationRepo.create.mockReturnValue(conversation);
      conversationRepo.save.mockResolvedValue(conversation);

      const result = await service.startSession({
        nativeLanguage: 'English',
        targetLanguage: 'Spanish',
      });

      expect(conversationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: AiConversationType.ANONYMOUS,
          title: 'Onboarding Chat',
          metadata: { nativeLanguage: 'English', targetLanguage: 'Spanish' },
        }),
      );
      expect(result.conversationId).toBe('conv-123');
    });
  });

  describe('chat', () => {
    it('returns AI reply with turn info for valid session', async () => {
      const conversation = makeConversation({ messageCount: 0 });
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([]);
      messageRepo.save.mockResolvedValue({});
      conversationRepo.increment.mockResolvedValue({});
      llmService.chat.mockResolvedValue('Hello! Tell me about yourself.');

      const result = await service.chat({ conversationId: 'conv-1', message: 'Hi' });

      expect(result.reply).toBe('Hello! Tell me about yourself.');
      expect(result.turnNumber).toBe(1);
      expect(result.isLastTurn).toBe(false);
    });

    it('throws NotFoundException for invalid conversationId', async () => {
      conversationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.chat({ conversationId: 'bad-id', message: 'Hi' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when session is expired', async () => {
      const expired = makeConversation({ expiresAt: new Date(Date.now() - 1000) });
      conversationRepo.findOne.mockResolvedValue(expired);

      await expect(
        service.chat({ conversationId: 'conv-1', message: 'Hi' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when max turns exceeded', async () => {
      // messageCount = maxTurns * 2 means currentTurn = maxTurns + 1
      const conversation = makeConversation({ messageCount: onboardingConfig.maxTurns * 2 });
      conversationRepo.findOne.mockResolvedValue(conversation);

      await expect(
        service.chat({ conversationId: 'conv-1', message: 'Hi' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('increments messageCount by 2 after saving messages', async () => {
      const conversation = makeConversation({ messageCount: 0 });
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([]);
      messageRepo.save.mockResolvedValue({});
      conversationRepo.increment.mockResolvedValue({});
      llmService.chat.mockResolvedValue('Reply');

      await service.chat({ conversationId: 'conv-1', message: 'Hi' });

      expect(conversationRepo.increment).toHaveBeenCalledWith(
        { id: 'conv-1' },
        'messageCount',
        2,
      );
    });

    it('marks isLastTurn=true on final turn', async () => {
      // currentTurn = maxTurns when messageCount = (maxTurns-1)*2
      const conversation = makeConversation({ messageCount: (onboardingConfig.maxTurns - 1) * 2 });
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([]);
      messageRepo.save.mockResolvedValue({});
      conversationRepo.increment.mockResolvedValue({});
      llmService.chat.mockResolvedValue('Final reply');

      const result = await service.chat({ conversationId: 'conv-1', message: 'Hi' });

      expect(result.isLastTurn).toBe(true);
      expect(result.turnNumber).toBe(onboardingConfig.maxTurns);
    });
  });

  const makeValidScenariosJson = () =>
    JSON.stringify([
      { title: 'Scenario 1', description: 'Desc 1', icon: 'briefcase', accentColor: 'primary' },
      { title: 'Scenario 2', description: 'Desc 2', icon: 'coffee', accentColor: 'blue' },
      { title: 'Scenario 3', description: 'Desc 3', icon: 'globe', accentColor: 'green' },
      { title: 'Scenario 4', description: 'Desc 4', icon: 'book', accentColor: 'lavender' },
      { title: 'Scenario 5', description: 'Desc 5', icon: 'mic', accentColor: 'rose' },
    ]);

  describe('complete', () => {
    it('extracts JSON from transcript and returns profile + 5 scenarios', async () => {
      const conversation = makeConversation();
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([
        { role: 'user', content: 'I want to learn Spanish', createdAt: new Date() },
        { role: 'assistant', content: 'Great!', createdAt: new Date() },
      ]);

      const profile = { nativeLanguage: 'English', targetLanguage: 'Spanish', currentLevel: 'A1' };
      // chat called twice: 1st for extraction, 2nd for scenarios
      llmService.chat
        .mockResolvedValueOnce(`\`\`\`json\n${JSON.stringify(profile)}\n\`\`\``)
        .mockResolvedValueOnce(makeValidScenariosJson());

      const result = await service.complete({ conversationId: 'conv-1' });

      expect(result).toMatchObject(profile);
      expect(result.scenarios).toHaveLength(5);
    });

    it('returns profile with empty scenarios [] when scenario LLM call fails', async () => {
      const conversation = makeConversation();
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([]);

      const profile = { nativeLanguage: 'English', targetLanguage: 'Spanish' };
      llmService.chat
        .mockResolvedValueOnce(JSON.stringify(profile))
        .mockRejectedValueOnce(new Error('LLM timeout'));

      const result = await service.complete({ conversationId: 'conv-1' });

      expect(result).toMatchObject(profile);
      expect(result.scenarios).toEqual([]);
    });

    it('returns empty scenarios [] when LLM returns wrong count', async () => {
      const conversation = makeConversation();
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([]);

      const profile = { nativeLanguage: 'English', targetLanguage: 'Spanish' };
      const badScenarios = JSON.stringify([
        { title: 'S1', description: 'D1', icon: 'star', accentColor: 'primary' },
        { title: 'S2', description: 'D2', icon: 'star', accentColor: 'blue' },
      ]);
      llmService.chat
        .mockResolvedValueOnce(JSON.stringify(profile))
        .mockResolvedValueOnce(badScenarios);

      const result = await service.complete({ conversationId: 'conv-1' });

      expect(result.scenarios).toEqual([]);
    });

    it('assigns server-generated UUIDs to scenarios', async () => {
      const conversation = makeConversation();
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([]);

      const profile = { nativeLanguage: 'English', targetLanguage: 'Spanish' };
      llmService.chat
        .mockResolvedValueOnce(JSON.stringify(profile))
        .mockResolvedValueOnce(makeValidScenariosJson());

      const result = await service.complete({ conversationId: 'conv-1' });

      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      result.scenarios.forEach((s: { id: string }) => {
        expect(s.id).toMatch(uuidPattern);
      });
    });

    it('falls back accentColor to "primary" when LLM returns invalid value', async () => {
      const conversation = makeConversation();
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([]);

      const profile = { nativeLanguage: 'English', targetLanguage: 'Spanish' };
      const scenariosWithBadColor = JSON.stringify([
        { title: 'S1', description: 'D1', icon: 'star', accentColor: 'invalid-color' },
        { title: 'S2', description: 'D2', icon: 'star', accentColor: 'blue' },
        { title: 'S3', description: 'D3', icon: 'star', accentColor: 'green' },
        { title: 'S4', description: 'D4', icon: 'star', accentColor: 'lavender' },
        { title: 'S5', description: 'D5', icon: 'star', accentColor: 'rose' },
      ]);
      llmService.chat
        .mockResolvedValueOnce(JSON.stringify(profile))
        .mockResolvedValueOnce(scenariosWithBadColor);

      const result = await service.complete({ conversationId: 'conv-1' });

      expect(result.scenarios[0].accentColor).toBe('primary');
      expect(result.scenarios[1].accentColor).toBe('blue');
    });
  });
});
