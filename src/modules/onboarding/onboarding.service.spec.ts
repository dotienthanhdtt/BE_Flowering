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
    sessionToken: 'token-abc',
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
    it('creates conversation with correct fields and returns token + conversationId', async () => {
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
      expect(result.sessionToken).toBeDefined();
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

      const result = await service.chat({ sessionToken: 'token-abc', message: 'Hi' });

      expect(result.reply).toBe('Hello! Tell me about yourself.');
      expect(result.turnNumber).toBe(1);
      expect(result.isLastTurn).toBe(false);
    });

    it('throws NotFoundException for invalid session token', async () => {
      conversationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.chat({ sessionToken: 'bad-token', message: 'Hi' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when session is expired', async () => {
      const expired = makeConversation({ expiresAt: new Date(Date.now() - 1000) });
      conversationRepo.findOne.mockResolvedValue(expired);

      await expect(
        service.chat({ sessionToken: 'token-abc', message: 'Hi' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when max turns exceeded', async () => {
      // messageCount = maxTurns * 2 means currentTurn = maxTurns + 1
      const conversation = makeConversation({ messageCount: onboardingConfig.maxTurns * 2 });
      conversationRepo.findOne.mockResolvedValue(conversation);

      await expect(
        service.chat({ sessionToken: 'token-abc', message: 'Hi' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('increments messageCount by 2 after saving messages', async () => {
      const conversation = makeConversation({ messageCount: 0 });
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([]);
      messageRepo.save.mockResolvedValue({});
      conversationRepo.increment.mockResolvedValue({});
      llmService.chat.mockResolvedValue('Reply');

      await service.chat({ sessionToken: 'token-abc', message: 'Hi' });

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

      const result = await service.chat({ sessionToken: 'token-abc', message: 'Hi' });

      expect(result.isLastTurn).toBe(true);
      expect(result.turnNumber).toBe(onboardingConfig.maxTurns);
    });
  });

  describe('complete', () => {
    it('extracts JSON from conversation transcript in code block', async () => {
      const conversation = makeConversation();
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([
        { role: 'user', content: 'I want to learn Spanish', createdAt: new Date() },
        { role: 'assistant', content: 'Great!', createdAt: new Date() },
      ]);

      const jsonPayload = { nativeLanguage: 'English', targetLanguage: 'Spanish', level: 'beginner' };
      llmService.chat.mockResolvedValue(`\`\`\`json\n${JSON.stringify(jsonPayload)}\n\`\`\``);

      const result = await service.complete({ sessionToken: 'token-abc' });

      expect(result).toEqual(jsonPayload);
    });

    it('returns raw response object when JSON parsing fails', async () => {
      const conversation = makeConversation();
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([]);
      llmService.chat.mockResolvedValue('not valid json at all');

      const result = await service.complete({ sessionToken: 'token-abc' });

      expect(result).toEqual({ raw: 'not valid json at all' });
    });
  });
});
