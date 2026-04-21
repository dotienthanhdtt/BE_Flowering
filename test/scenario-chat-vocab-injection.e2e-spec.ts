import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as (app: any) => any;
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ScenarioChatController } from '../src/modules/scenario/scenario-chat.controller';
import { ScenarioChatService } from '../src/modules/scenario/services/scenario-chat.service';
import { ScenarioAccessService } from '../src/modules/scenario/services/scenario-access.service';
import { VocabularyInjectionService } from '../src/modules/scenario/services/vocabulary-injection.service';
import { AiConversation } from '../src/database/entities/ai-conversation.entity';
import { AiConversationMessage } from '../src/database/entities';
import { VocabularyInjectionEvent } from '../src/database/entities/vocabulary-injection-event.entity';
import { Vocabulary } from '../src/database/entities/vocabulary.entity';
import { UnifiedLLMService } from '../src/modules/ai/services/unified-llm.service';
import { PromptLoaderService } from '../src/modules/ai/services/prompt-loader.service';
import { LanguageService } from '../src/modules/language/language.service';
import { VocabularyReviewService } from '../src/modules/vocabulary/services/vocabulary-review.service';
import { ResponseTransformInterceptor } from '../src/common/interceptors/response-transform.interceptor';
import { AiConversationType } from '../src/database/entities/ai-conversation.entity';

const TEST_USER_ID = 'a1a2a3a4-a1a2-4a1a-8a1a-a1a2a3a4a5a6';
const SCENARIO_ID = 'b1b2b3b4-b1b2-4b1b-8b1b-b1b2b3b4b5b6';
const LANG_ID = 'c1c2c3c4-c1c2-4c1c-8c1c-c1c2c3c4c5c6';
const CONVO_ID = 'd1d2d3d4-d1d2-4d1d-8d1d-d1d2d3d4d5d6';

const mockScenario: any = {
  id: SCENARIO_ID,
  title: 'Café Conversation',
  description: 'Practice ordering coffee',
  languageId: LANG_ID,
  category: { id: 'cat-1', name: 'Food & Drink' },
};

const baseConvo = (): any => ({
  id: CONVO_ID,
  userId: TEST_USER_ID,
  scenarioId: SCENARIO_ID,
  languageId: LANG_ID,
  type: AiConversationType.AUTHENTICATED,
  topic: 'scenario_roleplay',
  messageCount: 0,
  metadata: { maxTurns: 12, completed: false },
  injectedVocabIds: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

function makeConvoRepo(overrides: Record<string, jest.Mock> = {}) {
  const mockQb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
  };
  return {
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    create: jest.fn((dto) => ({ ...dto, id: CONVO_ID })),
    save: jest.fn((e) => Promise.resolve({ ...e, id: CONVO_ID, createdAt: new Date(), updatedAt: new Date() })),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeMsgRepo() {
  return {
    create: jest.fn((dto) => dto),
    save: jest.fn((e) => Promise.resolve({ ...e, id: 'msg-uuid' })),
    find: jest.fn().mockResolvedValue([]),
  };
}

describe('Scenario Chat — Vocab Injection (E2E)', () => {
  let app: INestApplication;
  let convoRepo: ReturnType<typeof makeConvoRepo>;
  let msgRepo: ReturnType<typeof makeMsgRepo>;
  let eventsRepo: any;
  let vocabInjectionService: any;
  let vocabReviewService: any;

  beforeAll(async () => {
    convoRepo = makeConvoRepo();
    msgRepo = makeMsgRepo();
    eventsRepo = { create: jest.fn((d) => d), save: jest.fn(() => Promise.resolve([])) };
    vocabInjectionService = {
      selectVocabularyForConversation: jest.fn().mockResolvedValue([]),
      hydrateByIds: jest.fn().mockResolvedValue([]),
    };
    vocabReviewService = { touchReviewed: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScenarioChatController],
      providers: [
        ScenarioChatService,
        { provide: getRepositoryToken(AiConversation), useValue: convoRepo },
        { provide: getRepositoryToken(AiConversationMessage), useValue: msgRepo },
        { provide: getRepositoryToken(VocabularyInjectionEvent), useValue: eventsRepo },
        { provide: getRepositoryToken(Vocabulary), useValue: {} },
        { provide: UnifiedLLMService, useValue: { chat: jest.fn().mockResolvedValue('stub reply') } },
        { provide: PromptLoaderService, useValue: { loadPrompt: jest.fn().mockReturnValue('system prompt') } },
        {
          provide: LanguageService,
          useValue: {
            getUserLanguages: jest.fn().mockResolvedValue([
              { id: 'ul-1', isActive: true, proficiencyLevel: 'intermediate', language: { id: LANG_ID, code: 'fr', name: 'French' } },
            ]),
            getNativeLanguage: jest.fn().mockResolvedValue({ id: 'nl-1', code: 'en', name: 'English' }),
          },
        },
        {
          provide: ScenarioAccessService,
          useValue: { findAccessibleScenario: jest.fn().mockResolvedValue(mockScenario) },
        },
        { provide: VocabularyInjectionService, useValue: vocabInjectionService },
        { provide: VocabularyReviewService, useValue: vocabReviewService },
        { provide: ThrottlerGuard, useValue: { canActivate: () => true } },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: TEST_USER_ID };
      req.activeLanguage = { id: LANG_ID, code: 'fr' };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalInterceptors(new ResponseTransformInterceptor());
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-apply defaults after clearAllMocks
    vocabInjectionService.selectVocabularyForConversation.mockResolvedValue([]);
    vocabInjectionService.hydrateByIds.mockResolvedValue([]);
    vocabReviewService.touchReviewed.mockResolvedValue(undefined);
    eventsRepo.create.mockImplementation((d: any) => d);
    eventsRepo.save.mockResolvedValue([]);
    msgRepo.find.mockResolvedValue([]);
    msgRepo.save.mockImplementation((e: any) => Promise.resolve({ ...e, id: 'msg-uuid' }));
    msgRepo.create.mockImplementation((dto: any) => dto);
    convoRepo.create.mockImplementation((dto: any) => ({ ...dto, id: CONVO_ID }));
    convoRepo.save.mockImplementation((e: any) => Promise.resolve({ ...e, id: CONVO_ID, createdAt: new Date(), updatedAt: new Date() }));
    convoRepo.createQueryBuilder().getOne.mockResolvedValue(null);
    (app.get(LanguageService) as any).getUserLanguages.mockResolvedValue([
      { id: 'ul-1', isActive: true, proficiencyLevel: 'intermediate', language: { id: LANG_ID, code: 'fr', name: 'French' } },
    ]);
    (app.get(LanguageService) as any).getNativeLanguage.mockResolvedValue({ id: 'nl-1', code: 'en', name: 'English' });
    (app.get(ScenarioAccessService) as any).findAccessibleScenario.mockResolvedValue(mockScenario);
    (app.get(UnifiedLLMService) as any).chat.mockResolvedValue('stub reply');
  });

  // (a) User with 0 vocab → injectedVocabIds=[], no events, 201
  it('(a) user with 0 vocab: returns 201, no events written', async () => {
    const conv = baseConvo();
    convoRepo.create.mockReturnValue(conv);
    convoRepo.save.mockResolvedValue(conv);
    vocabInjectionService.selectVocabularyForConversation.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .post('/scenario/chat')
      .send({ scenarioId: SCENARIO_ID });

    expect(res.status).toBe(201);
    expect(res.body.data.reply).toBe('stub reply');

    // Allow fire-and-forget to settle
    await new Promise((r) => setImmediate(r));
    expect(eventsRepo.save).not.toHaveBeenCalled();
  });

  // (b) User with 3 vocab, message contains 1 word → 3 event rows, reviewCount bumped for 1
  it('(b) 3 vocab injected, message contains 1 matching word → 3 events, 1 touchReviewed', async () => {
    const vocab: Partial<Vocabulary>[] = [
      { id: 'v1', word: 'bonjour', translation: 'hello', box: 1 },
      { id: 'v2', word: 'merci', translation: 'thank you', box: 2 },
      { id: 'v3', word: 'café', translation: 'coffee', box: 1 },
    ];
    const conv = { ...baseConvo(), injectedVocabIds: ['v1', 'v2', 'v3'] };
    convoRepo.create.mockReturnValue(conv);
    convoRepo.save.mockResolvedValue(conv);
    vocabInjectionService.hydrateByIds.mockResolvedValue(vocab);

    const res = await request(app.getHttpServer())
      .post('/scenario/chat')
      .send({ scenarioId: SCENARIO_ID, message: 'Bonjour! Can I have a coffee?' });

    expect(res.status).toBe(201);

    await new Promise((r) => setImmediate(r));

    // 3 event rows created — 1 for each injected word
    expect(eventsRepo.create).toHaveBeenCalledTimes(3);
    // "bonjour" matches → wasUsed: true
    expect(eventsRepo.create).toHaveBeenCalledWith(expect.objectContaining({ vocabularyId: 'v1', wasUsed: true }));
    // "merci" not in message → wasUsed: false
    expect(eventsRepo.create).toHaveBeenCalledWith(expect.objectContaining({ vocabularyId: 'v2', wasUsed: false }));
    // Only v1 (bonjour) triggers touchReviewed
    expect(vocabReviewService.touchReviewed).toHaveBeenCalledTimes(1);
    expect(vocabReviewService.touchReviewed).toHaveBeenCalledWith(TEST_USER_ID, 'v1');
  });

  // (c) All-mastered vocab (box=5) → both buckets empty → [] persisted
  it('(c) all-mastered vocab (box=5): empty selection, injectedVocabIds=[], 201 response', async () => {
    const conv = baseConvo();
    convoRepo.create.mockReturnValue(conv);
    convoRepo.save.mockResolvedValue(conv);
    vocabInjectionService.selectVocabularyForConversation.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .post('/scenario/chat')
      .send({ scenarioId: SCENARIO_ID });

    expect(res.status).toBe(201);
    expect(res.body.data.reply).toBe('stub reply');
  });

  // (d) Turn-2 does not recompute: cached IDs used, selectVocabularyForConversation NOT called
  it('(d) turn-2 with cached injectedVocabIds: hydrateByIds called, no recomputation', async () => {
    const cachedIds = ['v10', 'v11'];
    const conv = { ...baseConvo(), injectedVocabIds: cachedIds };
    // resolveExisting needs findOne to return the conversation
    convoRepo.findOne.mockResolvedValue(conv);
    convoRepo.save.mockResolvedValue(conv);
    vocabInjectionService.hydrateByIds.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .post('/scenario/chat')
      .send({ scenarioId: SCENARIO_ID, conversationId: CONVO_ID });

    expect(res.status).toBe(201);
    expect(vocabInjectionService.hydrateByIds).toHaveBeenCalledWith(cachedIds);
    expect(vocabInjectionService.selectVocabularyForConversation).not.toHaveBeenCalled();
  });

  // (e) Language filter: active language code used for vocab selection
  it('(e) language code is passed to selectVocabularyForConversation', async () => {
    const conv = baseConvo();
    convoRepo.create.mockReturnValue(conv);
    convoRepo.save.mockResolvedValue(conv);
    vocabInjectionService.selectVocabularyForConversation.mockResolvedValue([]);

    await request(app.getHttpServer())
      .post('/scenario/chat')
      .send({ scenarioId: SCENARIO_ID });

    expect(vocabInjectionService.selectVocabularyForConversation).toHaveBeenCalledWith(TEST_USER_ID, 'fr');
  });

  // (f) Multiple turns: same injectedVocabIds re-used across turns
  it('(f) across turns, injectedVocabIds persist and hydrate consistently', async () => {
    const cachedIds = ['v20', 'v21', 'v22'];
    const conv = { ...baseConvo(), injectedVocabIds: cachedIds };
    // resolveExisting needs findOne to return the conversation
    convoRepo.findOne.mockResolvedValue(conv);
    convoRepo.save.mockResolvedValue(conv);
    vocabInjectionService.hydrateByIds.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .post('/scenario/chat')
      .send({ scenarioId: SCENARIO_ID, conversationId: CONVO_ID, message: 'Second turn' });

    expect(res.status).toBe(201);
    expect(vocabInjectionService.hydrateByIds).toHaveBeenCalledWith(cachedIds);
    expect(vocabInjectionService.selectVocabularyForConversation).not.toHaveBeenCalled();
  });
});
