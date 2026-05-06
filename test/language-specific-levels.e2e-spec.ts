import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as (app: any) => any;
import { getRepositoryToken } from '@nestjs/typeorm';
import { useContainer } from 'class-validator';
import { LanguageModule } from '../src/modules/language/language.module';
import { Language } from '../src/database/entities/language.entity';
import { UserLanguage } from '../src/database/entities/user-language.entity';
import { User } from '../src/database/entities/user.entity';
import { ResponseTransformInterceptor } from '../src/common/interceptors/response-transform.interceptor';
import { IsValidLevelForLanguageConstraint } from '../src/common/validators/is-valid-level-for-language.validator';

const TEST_USER_ID = 'test-user-uuid';

const JA_ID = '11111111-1111-1111-1111-111111111111';
const EN_ID = '22222222-2222-2222-2222-222222222222';

const jaLang = {
  id: JA_ID, code: 'ja', name: 'Japanese', nativeName: '日本語', flagUrl: null,
  isActive: true, isLearningAvailable: true, isNativeAvailable: false, levelFramework: 'JLPT',
};

const enLang = {
  id: EN_ID, code: 'en', name: 'English', nativeName: 'English', flagUrl: null,
  isActive: true, isLearningAvailable: true, isNativeAvailable: true, levelFramework: 'CEFR',
};

function mockLangRepo() {
  return { find: jest.fn(), findOne: jest.fn() };
}

function mockULRepo() {
  return { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn(), delete: jest.fn() };
}

describe('Language-Specific Levels (E2E)', () => {
  let app: INestApplication;
  let languageRepo: ReturnType<typeof mockLangRepo>;
  let userLanguageRepo: ReturnType<typeof mockULRepo>;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [LanguageModule],
    })
      .overrideProvider(getRepositoryToken(Language))
      .useFactory({ factory: mockLangRepo })
      .overrideProvider(getRepositoryToken(UserLanguage))
      .useFactory({ factory: mockULRepo })
      .overrideProvider(getRepositoryToken(User))
      .useValue({ findOne: jest.fn(), update: jest.fn() })
      .overrideProvider(IsValidLevelForLanguageConstraint)
      .useValue({ validate: jest.fn().mockResolvedValue(true), defaultMessage: jest.fn() })
      .compile();

    languageRepo = module.get(getRepositoryToken(Language));
    userLanguageRepo = module.get(getRepositoryToken(UserLanguage));

    // Satisfy OnModuleInit boot invariant before app.init()
    languageRepo.find.mockResolvedValue([]);

    app = module.createNestApplication();
    // Inject test user so @CurrentUser() resolves without a real JWT guard
    app.use((req: any, _res: any, next: any) => { req.user = { id: TEST_USER_ID }; next(); });
    useContainer(module, { fallbackOnErrors: true });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalInterceptors(new ResponseTransformInterceptor());
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => jest.clearAllMocks());

  // ─── Test 1 ────────────────────────────────────────────────────────────────
  it('GET /languages returns ordered levels array per framework', async () => {
    languageRepo.find.mockResolvedValue([jaLang, enLang]);

    const res = await request(app.getHttpServer()).get('/languages');

    expect(res.status).toBe(200);
    const langs: any[] = res.body.data;
    const ja = langs.find((l) => l.code === 'ja');
    expect(ja.levels).toEqual(['N5', 'N4', 'N3', 'N2', 'N1']);
    const en = langs.find((l) => l.code === 'en');
    expect(en.levels).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  });

  // ─── Test 2 ────────────────────────────────────────────────────────────────
  it('PATCH /languages/user/:id with valid JLPT level returns 200', async () => {
    const jaUserLang = {
      id: '33333333-3333-3333-3333-333333333333', userId: TEST_USER_ID, languageId: JA_ID,
      isActive: true, proficiencyLevel: 'N5', language: jaLang,
    };
    userLanguageRepo.findOne.mockResolvedValue(jaUserLang);
    userLanguageRepo.save.mockResolvedValue({ ...jaUserLang, proficiencyLevel: 'N3' });

    const res = await request(app.getHttpServer())
      .patch(`/languages/user/${JA_ID}`)
      .send({ proficiencyLevel: 'N3' });

    expect(res.status).toBe(200);
  });

  // ─── Test 3 ────────────────────────────────────────────────────────────────
  it('PATCH /languages/user/:id with invalid level on JLPT language returns 400', async () => {
    const jaUserLang = {
      id: '33333333-3333-3333-3333-333333333333', userId: TEST_USER_ID, languageId: JA_ID,
      isActive: true, proficiencyLevel: 'N5', language: jaLang,
    };
    userLanguageRepo.findOne.mockResolvedValue(jaUserLang);

    const res = await request(app.getHttpServer())
      .patch(`/languages/user/${JA_ID}`)
      .send({ proficiencyLevel: 'X9' });

    expect(res.status).toBe(400);
  });

  // ─── Test 4 ────────────────────────────────────────────────────────────────
  it('PATCH /languages/user/:id with JLPT level on CEFR language returns 400', async () => {
    const enUserLang = {
      id: '44444444-4444-4444-4444-444444444444', userId: TEST_USER_ID, languageId: EN_ID,
      isActive: true, proficiencyLevel: 'A1', language: enLang,
    };
    userLanguageRepo.findOne.mockResolvedValue(enUserLang);

    const res = await request(app.getHttpServer())
      .patch(`/languages/user/${EN_ID}`)
      .send({ proficiencyLevel: 'N3' });

    expect(res.status).toBe(400);
  });
});
