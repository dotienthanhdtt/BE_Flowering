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

const VALID_UUID = '7e982513-fff0-4d07-b008-36dd8047c326';

const mockConversationRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  increment: jest.fn(),
  update: jest.fn(),
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

  describe('handleChat', () => {
    describe('create branch (no conversationId)', () => {
      it('creates a new session, returns conversationId + first-turn greeting', async () => {
        const newConversation = makeConversation({ id: VALID_UUID });
        conversationRepo.create.mockReturnValue(newConversation);
        conversationRepo.save.mockResolvedValue(newConversation);
        // findOne is called by the internal chat() after session is created
        conversationRepo.findOne.mockResolvedValue(newConversation);
        messageRepo.find.mockResolvedValue([]);
        messageRepo.save.mockResolvedValue({ id: 'msg-1' });
        conversationRepo.increment.mockResolvedValue({});
        llmService.chat.mockResolvedValue(JSON.stringify({ reply: 'Hello! Welcome.', isLastTurn: false }));

        const result = await service.handleChat({
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
        expect(conversationRepo.save).toHaveBeenCalledTimes(1);
        expect(result.conversationId).toBe(VALID_UUID);
        expect(result.reply).toBe('Hello! Welcome.');
        expect(result.turnNumber).toBe(1);
        expect(result.isLastTurn).toBe(false);
        expect(result.messageId).toBeDefined();
      });

      it('saves only assistant message on first turn (no user message stored)', async () => {
        const newConversation = makeConversation({ id: VALID_UUID });
        conversationRepo.create.mockReturnValue(newConversation);
        conversationRepo.save.mockResolvedValue(newConversation);
        conversationRepo.findOne.mockResolvedValue(newConversation);
        messageRepo.find.mockResolvedValue([]);
        messageRepo.save.mockResolvedValue({ id: 'msg-1' });
        conversationRepo.increment.mockResolvedValue({});
        llmService.chat.mockResolvedValue('Assistant greeting');

        await service.handleChat({
          nativeLanguage: 'English',
          targetLanguage: 'Spanish',
        });

        // messageRepo.save called once (assistant only, no user message on first turn)
        expect(messageRepo.save).toHaveBeenCalledTimes(1);
        // messageCount incremented by 1 (first turn)
        expect(conversationRepo.increment).toHaveBeenCalledWith(
          { id: VALID_UUID },
          'messageCount',
          1,
        );
      });

      it('ignores message field when creating a new session (uses "Start" prompt)', async () => {
        const newConversation = makeConversation({ id: VALID_UUID, messageCount: 0 });
        conversationRepo.create.mockReturnValue(newConversation);
        conversationRepo.save.mockResolvedValue(newConversation);
        conversationRepo.findOne.mockResolvedValue(newConversation);
        messageRepo.find.mockResolvedValue([]);
        messageRepo.save.mockResolvedValue({ id: 'msg-1' });
        conversationRepo.increment.mockResolvedValue({});
        llmService.chat.mockResolvedValue('Greeting');

        // Even though message is provided, it should not be stored as a user message
        await service.handleChat({
          nativeLanguage: 'English',
          targetLanguage: 'Spanish',
          message: 'this should be ignored',
        });

        // Only 1 save call = assistant message only (message field ignored on creation)
        expect(messageRepo.save).toHaveBeenCalledTimes(1);
      });
    });

    describe('continue branch (with conversationId)', () => {
      it('reuses existing session and returns chat response with same conversationId', async () => {
        const conversation = makeConversation({ id: VALID_UUID, messageCount: 1 });
        conversationRepo.findOne.mockResolvedValue(conversation);
        messageRepo.find.mockResolvedValue([]);
        messageRepo.save.mockResolvedValue({ id: 'msg-2' });
        conversationRepo.increment.mockResolvedValue({});
        llmService.chat.mockResolvedValue(JSON.stringify({ reply: 'Nice to meet you!', isLastTurn: false }));

        const result = await service.handleChat({
          conversationId: VALID_UUID,
          message: 'Hello',
        });

        // No new conversation created
        expect(conversationRepo.create).not.toHaveBeenCalled();
        expect(result.conversationId).toBe(VALID_UUID);
        expect(result.reply).toBe('Nice to meet you!');
        expect(result.turnNumber).toBe(2);
      });

      it('throws NotFoundException for invalid conversationId', async () => {
        conversationRepo.findOne.mockResolvedValue(null);

        await expect(
          service.handleChat({ conversationId: 'bad-id', message: 'Hi' }),
        ).rejects.toThrow(NotFoundException);
      });

      it('throws BadRequestException when max turns exceeded', async () => {
        // messageCount = maxTurns * 2 means currentTurn = maxTurns + 1
        const conversation = makeConversation({ messageCount: onboardingConfig.maxTurns * 2 });
        conversationRepo.findOne.mockResolvedValue(conversation);

        await expect(
          service.handleChat({ conversationId: VALID_UUID, message: 'Hi' }),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('turn counting (via handleChat continue branch)', () => {
      it('increments messageCount by 1 on first turn (msgCount=0)', async () => {
        const newConversation = makeConversation({ id: VALID_UUID, messageCount: 0 });
        conversationRepo.create.mockReturnValue(newConversation);
        conversationRepo.save.mockResolvedValue(newConversation);
        conversationRepo.findOne.mockResolvedValue(newConversation);
        messageRepo.find.mockResolvedValue([]);
        messageRepo.save.mockResolvedValue({ id: 'msg-1' });
        conversationRepo.increment.mockResolvedValue({});
        llmService.chat.mockResolvedValue('Reply');

        // First turn via create branch (no conversationId)
        await service.handleChat({ nativeLanguage: 'English', targetLanguage: 'Spanish' });

        expect(conversationRepo.increment).toHaveBeenCalledWith(
          { id: VALID_UUID },
          'messageCount',
          1,
        );
      });

      it('increments messageCount by 2 after saving messages on second turn', async () => {
        const conversation = makeConversation({ id: VALID_UUID, messageCount: 1 });
        conversationRepo.findOne.mockResolvedValue(conversation);
        messageRepo.find.mockResolvedValue([]);
        messageRepo.save.mockResolvedValue({ id: 'msg-2' });
        conversationRepo.increment.mockResolvedValue({});
        llmService.chat.mockResolvedValue('Reply');

        await service.handleChat({ conversationId: VALID_UUID, message: 'Hi' });

        expect(conversationRepo.increment).toHaveBeenCalledWith(
          { id: VALID_UUID },
          'messageCount',
          2,
        );
      });

      it('throws BadRequestException when message missing on non-first turn', async () => {
        const conversation = makeConversation({ messageCount: 1 });
        conversationRepo.findOne.mockResolvedValue(conversation);

        await expect(
          service.handleChat({ conversationId: VALID_UUID }),
        ).rejects.toThrow(BadRequestException);
      });

      it('marks isLastTurn=true on final turn', async () => {
        // currentTurn = maxTurns when messageCount = (maxTurns-1)*2
        const conversation = makeConversation({
          id: VALID_UUID,
          messageCount: (onboardingConfig.maxTurns - 1) * 2,
        });
        conversationRepo.findOne.mockResolvedValue(conversation);
        messageRepo.find.mockResolvedValue([]);
        messageRepo.save.mockResolvedValue({ id: 'msg-last' });
        conversationRepo.increment.mockResolvedValue({});
        llmService.chat.mockResolvedValue('Final reply');

        const result = await service.handleChat({ conversationId: VALID_UUID, message: 'Hi' });

        expect(result.isLastTurn).toBe(true);
        expect(result.turnNumber).toBe(onboardingConfig.maxTurns);
      });
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

  describe('getMessages', () => {
    it('returns messages ordered by createdAt with turn metadata', async () => {
      const conversation = makeConversation({ id: VALID_UUID, messageCount: 3 });
      conversationRepo.findOne.mockResolvedValue(conversation);
      const rows = [
        { id: 'm1', role: 'assistant', content: 'Hi', createdAt: new Date('2026-01-01T00:00:00Z') },
        { id: 'm2', role: 'user', content: 'Hello', createdAt: new Date('2026-01-01T00:01:00Z') },
        { id: 'm3', role: 'assistant', content: 'Great!', createdAt: new Date('2026-01-01T00:02:00Z') },
      ];
      messageRepo.find.mockResolvedValue(rows);

      const result = await service.getMessages(VALID_UUID);

      expect(result.conversationId).toBe(VALID_UUID);
      expect(result.turnNumber).toBe(2); // (3-1)/2 + 1 = 2
      expect(result.maxTurns).toBe(onboardingConfig.maxTurns);
      expect(result.isLastTurn).toBe(false);
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0]).toEqual({
        id: 'm1',
        role: 'assistant',
        content: 'Hi',
        createdAt: rows[0].createdAt,
      });
      expect(messageRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'ASC' } }),
      );
    });

    it('returns turnNumber=0 for empty conversation', async () => {
      const conversation = makeConversation({ id: VALID_UUID, messageCount: 0 });
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([]);

      const result = await service.getMessages(VALID_UUID);

      expect(result.turnNumber).toBe(0);
      expect(result.messages).toEqual([]);
    });

    it('throws NotFoundException when conversation missing', async () => {
      conversationRepo.findOne.mockResolvedValue(null);

      await expect(service.getMessages(VALID_UUID)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when conversation is AUTHENTICATED (findValidSession filter)', async () => {
      // findValidSession already filters by type=ANONYMOUS, so null for non-anonymous
      conversationRepo.findOne.mockResolvedValue(null);

      await expect(service.getMessages(VALID_UUID)).rejects.toThrow(NotFoundException);
      expect(conversationRepo.findOne).toHaveBeenCalledWith({
        where: { id: VALID_UUID, type: AiConversationType.ANONYMOUS },
      });
    });
  });

  describe('complete (idempotency)', () => {
    const cachedProfile = {
      nativeLanguage: 'English',
      targetLanguage: 'Spanish',
      currentLevel: 'A1',
    };
    const cachedScenarios = Array.from({ length: 5 }, (_, i) => ({
      id: `00000000-0000-0000-0000-00000000000${i}`,
      title: `T${i}`,
      description: `D${i}`,
      icon: 'star',
      accentColor: 'primary' as const,
    }));

    it('returns cached profile + scenarios without calling LLM on 2nd call', async () => {
      const conversation = makeConversation({
        extractedProfile: cachedProfile,
        scenarios: cachedScenarios,
      } as Partial<AiConversation>);
      conversationRepo.findOne.mockResolvedValue(conversation);

      const result = await service.complete({ conversationId: 'conv-1' });

      expect(llmService.chat).not.toHaveBeenCalled();
      expect(messageRepo.find).not.toHaveBeenCalled();
      expect(result).toMatchObject(cachedProfile);
      expect(result.scenarios).toEqual(cachedScenarios);
    });

    it('writes cache when profile structured AND scenarios.length === 5', async () => {
      const conversation = makeConversation();
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([]);

      llmService.chat
        .mockResolvedValueOnce(JSON.stringify(cachedProfile))
        .mockResolvedValueOnce(makeValidScenariosJson());

      await service.complete({ conversationId: 'conv-1' });

      expect(conversationRepo.update).toHaveBeenCalledWith(
        conversation.id,
        expect.objectContaining({
          extractedProfile: expect.objectContaining({ nativeLanguage: 'English' }),
          scenarios: expect.any(Array),
        }),
      );
    });

    it('does NOT write cache when profile parse fails (raw fallback)', async () => {
      const conversation = makeConversation();
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([]);

      llmService.chat
        .mockResolvedValueOnce('not-json-at-all') // parseExtraction returns {raw: ...}
        .mockResolvedValueOnce(makeValidScenariosJson());

      await service.complete({ conversationId: 'conv-1' });

      expect(conversationRepo.update).not.toHaveBeenCalled();
    });

    it('does NOT write cache when scenarios empty (LLM failure)', async () => {
      const conversation = makeConversation();
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.find.mockResolvedValue([]);

      llmService.chat
        .mockResolvedValueOnce(JSON.stringify(cachedProfile))
        .mockRejectedValueOnce(new Error('LLM timeout'));

      await service.complete({ conversationId: 'conv-1' });

      expect(conversationRepo.update).not.toHaveBeenCalled();
    });
  });
});
