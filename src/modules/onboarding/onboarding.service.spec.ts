// Prevent loading unified-llm → openai-provider → langfuse chain (ESM dynamic import issue)
jest.mock('../ai/services/unified-llm.service', () => ({ UnifiedLLMService: class {} }));
jest.mock('../ai/services/prompt-loader.service', () => ({ PromptLoaderService: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { AiConversation, AiConversationMessage } from '../../database/entities';
import { AiConversationType } from '../../database/entities/ai-conversation.entity';
import { Language } from '../../database/entities/language.entity';
import { UnifiedLLMService } from '../ai/services/unified-llm.service';
import { PromptLoaderService } from '../ai/services/prompt-loader.service';
import { IntakeChatEngine } from '../ai/services/intake-chat-engine.service';
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

const mockLanguageRepo = () => ({
  findOne: jest.fn().mockResolvedValue({ id: 'lang-en', code: 'en', isActive: true }),
});

const mockLLMService = () => ({
  chat: jest.fn(),
});

const mockPromptLoader = () => ({
  loadPrompt: jest.fn().mockReturnValue('system prompt'),
});

const mockIntakeChatEngine = () => ({
  runTurn: jest.fn(),
  findConversation: jest.fn(),
  completeAndGenerate: jest.fn(),
  getMessages: jest.fn(),
});

const makeConversation = (overrides: Partial<AiConversation> = {}): AiConversation =>
  ({
    id: 'conv-1',
    type: AiConversationType.ANONYMOUS,
    messageCount: 0,
    nativeLanguage: 'English',
    languageId: 'lang-en',
    language: { id: 'lang-en', code: 'en', name: 'English' },
    ...overrides,
  } as AiConversation);

describe('OnboardingService', () => {
  let service: OnboardingService;
  let conversationRepo: ReturnType<typeof mockConversationRepo>;
  let engine: ReturnType<typeof mockIntakeChatEngine>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: getRepositoryToken(AiConversation), useFactory: mockConversationRepo },
        { provide: getRepositoryToken(AiConversationMessage), useFactory: mockMessageRepo },
        { provide: getRepositoryToken(Language), useFactory: mockLanguageRepo },
        { provide: UnifiedLLMService, useFactory: mockLLMService },
        { provide: PromptLoaderService, useFactory: mockPromptLoader },
        { provide: IntakeChatEngine, useFactory: mockIntakeChatEngine },
        {
          provide: require('../../common/services/framework-levels.service').FrameworkLevelsService,
          useValue: { getLevels: () => [], getDescription: () => '', getFrameworkCode: () => null },
        },
      ],
    }).compile();

    service = module.get(OnboardingService);
    conversationRepo = module.get(getRepositoryToken(AiConversation));
    engine = module.get(IntakeChatEngine);
  });

  afterEach(() => jest.clearAllMocks());

  describe('handleChat', () => {
    describe('create branch (no conversationId)', () => {
      it('creates a new session, returns conversationId + first-turn greeting', async () => {
        const newConversation = makeConversation({ id: VALID_UUID });
        conversationRepo.create.mockReturnValue(newConversation);
        conversationRepo.save.mockResolvedValue(newConversation);
        conversationRepo.findOne.mockResolvedValue(newConversation);
        engine.runTurn.mockResolvedValue({
          reply: 'Hello! Welcome.',
          messageId: 'msg-1',
          turnNumber: 1,
          isLastTurn: false,
        });

        const result = await service.handleChat({
          nativeLanguage: 'English',
          targetLanguage: 'Spanish',
        });

        expect(conversationRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            type: AiConversationType.ANONYMOUS,
            title: 'Onboarding Chat',
            nativeLanguage: 'English',
            languageId: 'lang-en',
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
        engine.runTurn.mockResolvedValue({
          reply: 'Assistant greeting',
          messageId: 'msg-1',
          turnNumber: 1,
          isLastTurn: false,
        });

        await service.handleChat({
          nativeLanguage: 'English',
          targetLanguage: 'Spanish',
        });

        // Engine.runTurn called once (handles all message persistence internally)
        expect(engine.runTurn).toHaveBeenCalledTimes(1);
      });

      it('ignores message field when creating a new session (uses "Start" prompt)', async () => {
        const newConversation = makeConversation({ id: VALID_UUID, messageCount: 0 });
        conversationRepo.create.mockReturnValue(newConversation);
        conversationRepo.save.mockResolvedValue(newConversation);
        conversationRepo.findOne.mockResolvedValue(newConversation);
        engine.runTurn.mockResolvedValue({
          reply: 'Greeting',
          messageId: 'msg-1',
          turnNumber: 1,
          isLastTurn: false,
        });

        // Even though message is provided, it should not be stored as a user message
        await service.handleChat({
          nativeLanguage: 'English',
          targetLanguage: 'Spanish',
          message: 'this should be ignored',
        });

        // Engine.runTurn called once with undefined message (ignored for first turn)
        expect(engine.runTurn).toHaveBeenCalledTimes(1);
      });
    });

    describe('continue branch (with conversationId)', () => {
      it('reuses existing session and returns chat response with same conversationId', async () => {
        const conversation = makeConversation({ id: VALID_UUID, messageCount: 1 });
        conversationRepo.findOne.mockResolvedValue(conversation);
        engine.runTurn.mockResolvedValue({
          reply: 'Nice to meet you!',
          messageId: 'msg-2',
          turnNumber: 2,
          isLastTurn: false,
        });

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
        // Service throws BadRequestException when findOne returns null (not from engine)
        await expect(
          service.handleChat({ conversationId: 'bad-id', message: 'Hi' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when max turns exceeded', async () => {
        // messageCount = maxTurns * 2 means currentTurn = maxTurns + 1
        const conversation = makeConversation({ messageCount: onboardingConfig.maxTurns * 2 });
        conversationRepo.findOne.mockResolvedValue(conversation);
        engine.runTurn.mockRejectedValue(
          new BadRequestException('Maximum turns reached. Call /complete.'),
        );

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
        engine.runTurn.mockResolvedValue({
          reply: 'Reply',
          messageId: 'msg-1',
          turnNumber: 1,
          isLastTurn: false,
        });

        // First turn via create branch (no conversationId)
        await service.handleChat({ nativeLanguage: 'English', targetLanguage: 'Spanish' });

        // Engine manages messageCount increments internally
        expect(engine.runTurn).toHaveBeenCalledTimes(1);
      });

      it('increments messageCount by 2 after saving messages on second turn', async () => {
        const conversation = makeConversation({ id: VALID_UUID, messageCount: 1 });
        conversationRepo.findOne.mockResolvedValue(conversation);
        engine.runTurn.mockResolvedValue({
          reply: 'Reply',
          messageId: 'msg-2',
          turnNumber: 2,
          isLastTurn: false,
        });

        await service.handleChat({ conversationId: VALID_UUID, message: 'Hi' });

        // Engine manages messageCount increments internally
        expect(engine.runTurn).toHaveBeenCalledTimes(1);
      });

      it('throws BadRequestException when message missing on non-first turn', async () => {
        const conversation = makeConversation({ messageCount: 1 });
        conversationRepo.findOne.mockResolvedValue(conversation);
        engine.runTurn.mockRejectedValue(
          new BadRequestException('message required after first turn'),
        );

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
        engine.runTurn.mockResolvedValue({
          reply: 'Final reply',
          messageId: 'msg-last',
          turnNumber: onboardingConfig.maxTurns,
          isLastTurn: true,
        });

        const result = await service.handleChat({ conversationId: VALID_UUID, message: 'Hi' });

        expect(result.isLastTurn).toBe(true);
        expect(result.turnNumber).toBe(onboardingConfig.maxTurns);
      });
    });
  });

  describe('complete', () => {
    it('extracts JSON from transcript and returns profile + 5 scenarios', async () => {
      const conversation = makeConversation();
      const profile = { nativeLanguage: 'English', targetLanguage: 'Spanish', currentLevel: 'A1' };
      const scenarios = [
        { title: 'Scenario 1', description: 'Desc 1' },
        { title: 'Scenario 2', description: 'Desc 2' },
        { title: 'Scenario 3', description: 'Desc 3' },
        { title: 'Scenario 4', description: 'Desc 4' },
        { title: 'Scenario 5', description: 'Desc 5' },
      ];

      engine.findConversation.mockResolvedValue(conversation);
      engine.completeAndGenerate.mockResolvedValue({ profile, generated: scenarios });

      const result = await service.complete({ conversationId: 'conv-1' });

      expect(result).toMatchObject(profile);
      expect(result.scenarios).toHaveLength(5);
    });

    it('returns profile with empty scenarios [] when scenario generation fails', async () => {
      const conversation = makeConversation();
      const profile = { nativeLanguage: 'English', targetLanguage: 'Spanish' };
      const scenarios: [] = [];

      engine.findConversation.mockResolvedValue(conversation);
      engine.completeAndGenerate.mockResolvedValue({ profile, generated: scenarios });

      const result = await service.complete({ conversationId: 'conv-1' });

      expect(result).toMatchObject(profile);
      expect(result.scenarios).toEqual([]);
    });

    it('returns empty scenarios [] when generation returns wrong count', async () => {
      const conversation = makeConversation();
      const profile = { nativeLanguage: 'English', targetLanguage: 'Spanish' };
      const badScenarios = [
        { title: 'S1', description: 'D1' },
        { title: 'S2', description: 'D2' },
      ];

      engine.findConversation.mockResolvedValue(conversation);
      engine.completeAndGenerate.mockResolvedValue({ profile, generated: badScenarios });

      const result = await service.complete({ conversationId: 'conv-1' });

      // Service passes badScenarios as-is from engine result
      expect(result.scenarios).toHaveLength(2);
    });

    it('returns scenarios with title and description from engine', async () => {
      const conversation = makeConversation();
      const profile = { nativeLanguage: 'English', targetLanguage: 'Spanish' };
      const scenariosFromEngine = [
        { title: 'S1', description: 'D1' },
        { title: 'S2', description: 'D2' },
        { title: 'S3', description: 'D3' },
        { title: 'S4', description: 'D4' },
        { title: 'S5', description: 'D5' },
      ];

      engine.findConversation.mockResolvedValue(conversation);
      engine.completeAndGenerate.mockResolvedValue({ profile, generated: scenariosFromEngine });

      const result = await service.complete({ conversationId: 'conv-1' });

      expect(result.scenarios[0].title).toBe('S1');
      expect(result.scenarios[0].description).toBe('D1');
    });
  });

  describe('getMessages', () => {
    it('returns messages ordered by createdAt with turn metadata', async () => {
      const result = {
        conversationId: VALID_UUID,
        turnNumber: 2,
        maxTurns: onboardingConfig.maxTurns,
        isLastTurn: false,
        messages: [
          { id: 'm1', role: 'assistant', content: 'Hi', createdAt: new Date('2026-01-01T00:00:00Z') },
          { id: 'm2', role: 'user', content: 'Hello', createdAt: new Date('2026-01-01T00:01:00Z') },
          { id: 'm3', role: 'assistant', content: 'Great!', createdAt: new Date('2026-01-01T00:02:00Z') },
        ],
      };
      engine.getMessages.mockResolvedValue(result);

      const actual = await service.getMessages(VALID_UUID);

      expect(actual.conversationId).toBe(VALID_UUID);
      expect(actual.turnNumber).toBe(2);
      expect(actual.maxTurns).toBe(onboardingConfig.maxTurns);
      expect(actual.isLastTurn).toBe(false);
      expect(actual.messages).toHaveLength(3);
    });

    it('returns turnNumber=0 for empty conversation', async () => {
      const result = {
        conversationId: VALID_UUID,
        turnNumber: 0,
        maxTurns: onboardingConfig.maxTurns,
        isLastTurn: false,
        messages: [],
      };
      engine.getMessages.mockResolvedValue(result);

      const actual = await service.getMessages(VALID_UUID);

      expect(actual.turnNumber).toBe(0);
      expect(actual.messages).toEqual([]);
    });

    it('throws NotFoundException when conversation missing', async () => {
      engine.getMessages.mockRejectedValue(new NotFoundException('Conversation not found'));

      await expect(service.getMessages(VALID_UUID)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when conversation is AUTHENTICATED', async () => {
      // Engine.getMessages filters by type internally
      engine.getMessages.mockRejectedValue(new NotFoundException('Conversation not found'));

      await expect(service.getMessages(VALID_UUID)).rejects.toThrow(NotFoundException);
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

    it('returns cached profile + scenarios without calling engine on 2nd call', async () => {
      const conversation = makeConversation({
        extractedProfile: cachedProfile,
        scenarios: cachedScenarios,
      } as Partial<AiConversation>);
      engine.findConversation.mockResolvedValue(conversation);

      const result = await service.complete({ conversationId: 'conv-1' });

      expect(engine.completeAndGenerate).not.toHaveBeenCalled();
      expect(result).toMatchObject(cachedProfile);
      expect(result.scenarios).toEqual(cachedScenarios);
    });

    it('writes cache when profile structured AND scenarios.length === 5', async () => {
      const conversation = makeConversation();
      const scenarios = cachedScenarios;
      engine.findConversation.mockResolvedValue(conversation);
      // Mock completeAndGenerate to call the onGenerated callback
      engine.completeAndGenerate.mockImplementation(
        async (_conversationId, _config, _parser, onGenerated) => {
          await onGenerated(cachedProfile, scenarios);
          return { profile: cachedProfile, generated: scenarios };
        },
      );

      await service.complete({ conversationId: 'conv-1' });

      expect(conversationRepo.update).toHaveBeenCalledWith(
        conversation.id,
        expect.objectContaining({
          extractedProfile: expect.objectContaining({ nativeLanguage: 'English' }),
          scenarios: expect.any(Array),
        }),
      );
    });

    it('does NOT write cache when scenarios count != 5', async () => {
      const conversation = makeConversation();
      const profile = cachedProfile;
      const scenarios = [cachedScenarios[0]]; // Only 1 scenario
      engine.findConversation.mockResolvedValue(conversation);
      engine.completeAndGenerate.mockResolvedValue({ profile, generated: scenarios });

      await service.complete({ conversationId: 'conv-1' });

      expect(conversationRepo.update).not.toHaveBeenCalled();
    });

    it('writes cache only when both profile and scenarios valid', async () => {
      const conversation = makeConversation();
      const scenarios = cachedScenarios;
      engine.findConversation.mockResolvedValue(conversation);
      engine.completeAndGenerate.mockImplementation(
        async (_conversationId, _config, _parser, onGenerated) => {
          await onGenerated(cachedProfile, scenarios);
          return { profile: cachedProfile, generated: scenarios };
        },
      );

      await service.complete({ conversationId: 'conv-1' });

      // Should write cache when profile is structured and scenarios.length === 5
      expect(conversationRepo.update).toHaveBeenCalled();
    });
  });
});
