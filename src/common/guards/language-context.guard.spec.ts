import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LanguageContextGuard } from './language-context.guard';
import { LanguageContextCacheService } from '../services/language-context-cache.service';
import { UserLanguage, ProficiencyLevel } from '../../database/entities/user-language.entity';
import { Language } from '../../database/entities/language.entity';
import { SKIP_LANGUAGE_CONTEXT, AUTO_ENROLL_LANGUAGE } from '../decorators/active-language.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public-route.decorator';

const mockUserLanguageRepo = () => ({
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn((dto) => dto),
});

const mockLanguageRepo = () => ({
  findOne: jest.fn(),
});

const mockLanguageCache = () => ({
  resolve: jest.fn(),
});

const makeContext = (options: {
  headers?: Record<string, string>;
  user?: { id: string };
  reflectorOverrides?: Record<string, boolean>;
}): ExecutionContext => {
  const request = {
    headers: options.headers ?? {},
    user: options.user,
    activeLanguage: undefined as unknown,
  };

  const reflectorValues = options.reflectorOverrides ?? {};

  const mockHandler = jest.fn();
  const mockClass = jest.fn();

  const reflector = {
    getAllAndOverride: jest.fn((key: string) => reflectorValues[key] ?? false),
  };

  const context = {
    getHandler: () => mockHandler,
    getClass: () => mockClass,
    switchToHttp: () => ({ getRequest: () => request }),
    _request: request,
    _reflector: reflector,
  } as unknown as ExecutionContext;

  return context;
};

describe('LanguageContextGuard', () => {
  let guard: LanguageContextGuard;
  let reflector: jest.Mocked<Reflector>;
  let userLanguageRepo: ReturnType<typeof mockUserLanguageRepo>;
  let languageRepo: ReturnType<typeof mockLanguageRepo>;
  let languageCache: ReturnType<typeof mockLanguageCache>;

  const mockUserId = 'user-uuid-1';
  const mockLangFr = { id: 'lang-fr', code: 'fr' };
  const mockLangEn = { id: 'lang-en', code: 'en' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LanguageContextGuard,
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn() } },
        { provide: LanguageContextCacheService, useFactory: mockLanguageCache },
        { provide: getRepositoryToken(UserLanguage), useFactory: mockUserLanguageRepo },
        { provide: getRepositoryToken(Language), useFactory: mockLanguageRepo },
      ],
    }).compile();

    guard = module.get<LanguageContextGuard>(LanguageContextGuard);
    reflector = module.get(Reflector);
    userLanguageRepo = module.get(getRepositoryToken(UserLanguage));
    languageRepo = module.get(getRepositoryToken(Language));
    languageCache = module.get(LanguageContextCacheService);

    // Default: no bypass metadata
    reflector.getAllAndOverride.mockReturnValue(false);
  });

  // --- Bypass decorators ---

  it('should pass when @SkipLanguageContext is present', async () => {
    reflector.getAllAndOverride.mockImplementation((key) =>
      key === SKIP_LANGUAGE_CONTEXT ? true : false,
    );
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(languageCache.resolve).not.toHaveBeenCalled();
  });

  it('should pass when @Public is present', async () => {
    reflector.getAllAndOverride.mockImplementation((key) =>
      key === IS_PUBLIC_KEY ? true : false,
    );
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(languageCache.resolve).not.toHaveBeenCalled();
  });

  // --- Header present ---

  it('should attach context when header is valid and user is enrolled', async () => {
    languageCache.resolve.mockResolvedValue(mockLangFr);
    userLanguageRepo.findOne.mockResolvedValue({ userId: mockUserId, languageId: mockLangFr.id });

    const ctx = makeContext({
      headers: { 'x-learning-language': 'fr' },
      user: { id: mockUserId },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    const request = ctx.switchToHttp().getRequest() as any;
    expect(request.activeLanguage).toEqual(mockLangFr);
  });

  it('should throw BadRequestException for unknown language code', async () => {
    languageCache.resolve.mockResolvedValue(null);

    const ctx = makeContext({
      headers: { 'x-learning-language': 'xx' },
      user: { id: mockUserId },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
  });

  it('should throw ForbiddenException when not enrolled and no @AutoEnrollLanguage', async () => {
    languageCache.resolve.mockResolvedValue(mockLangFr);
    userLanguageRepo.findOne.mockResolvedValue(null); // not enrolled
    reflector.getAllAndOverride.mockReturnValue(false); // no auto-enroll

    const ctx = makeContext({
      headers: { 'x-learning-language': 'fr' },
      user: { id: mockUserId },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  // --- Auto-enroll new behavior ---

  it('should auto-enroll with isActive=false and BEGINNER when @AutoEnrollLanguage is set', async () => {
    languageCache.resolve.mockResolvedValue(mockLangFr);
    userLanguageRepo.findOne
      .mockResolvedValueOnce(null) // not enrolled check
      .mockResolvedValueOnce(null); // race-check not triggered (no error thrown)
    languageRepo.findOne.mockResolvedValue({ id: mockLangFr.id, isActive: true, isLearningAvailable: true });
    userLanguageRepo.save.mockResolvedValue({});
    reflector.getAllAndOverride.mockImplementation((key) =>
      key === AUTO_ENROLL_LANGUAGE ? true : false,
    );

    const ctx = makeContext({
      headers: { 'x-learning-language': 'fr' },
      user: { id: mockUserId },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    expect(userLanguageRepo.create).toHaveBeenCalledWith({
      userId: mockUserId,
      languageId: mockLangFr.id,
      isActive: false,
      proficiencyLevel: ProficiencyLevel.BEGINNER,
    });
    expect(userLanguageRepo.save).toHaveBeenCalled();

    const request = ctx.switchToHttp().getRequest() as any;
    expect(request.activeLanguage).toEqual(mockLangFr);
  });

  it('should throw BadRequestException when auto-enroll language isLearningAvailable=false', async () => {
    languageCache.resolve.mockResolvedValue(mockLangFr);
    userLanguageRepo.findOne.mockResolvedValue(null);
    languageRepo.findOne.mockResolvedValue(null); // not learning-available
    reflector.getAllAndOverride.mockImplementation((key) =>
      key === AUTO_ENROLL_LANGUAGE ? true : false,
    );

    const ctx = makeContext({
      headers: { 'x-learning-language': 'fr' },
      user: { id: mockUserId },
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
    expect(userLanguageRepo.save).not.toHaveBeenCalled();
  });

  it('should be idempotent — if row exists on race check, proceeds without error', async () => {
    languageCache.resolve.mockResolvedValue(mockLangFr);
    userLanguageRepo.findOne
      .mockResolvedValueOnce(null) // initial enrollment check: not enrolled
      .mockResolvedValueOnce({ userId: mockUserId, languageId: mockLangFr.id }); // race-check: row exists now
    languageRepo.findOne.mockResolvedValue({ id: mockLangFr.id, isActive: true, isLearningAvailable: true });
    userLanguageRepo.save.mockRejectedValue(new Error('unique constraint violation'));
    reflector.getAllAndOverride.mockImplementation((key) =>
      key === AUTO_ENROLL_LANGUAGE ? true : false,
    );

    const ctx = makeContext({
      headers: { 'x-learning-language': 'fr' },
      user: { id: mockUserId },
    });

    // Should NOT throw — row exists after the race, swallowed gracefully
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should NOT deactivate existing active user_language rows during auto-enroll', async () => {
    languageCache.resolve.mockResolvedValue(mockLangFr);
    userLanguageRepo.findOne.mockResolvedValue(null);
    languageRepo.findOne.mockResolvedValue({ id: mockLangFr.id, isActive: true, isLearningAvailable: true });
    userLanguageRepo.save.mockResolvedValue({});
    reflector.getAllAndOverride.mockImplementation((key) =>
      key === AUTO_ENROLL_LANGUAGE ? true : false,
    );

    const ctx = makeContext({
      headers: { 'x-learning-language': 'fr' },
      user: { id: mockUserId },
    });

    await guard.canActivate(ctx);

    // Saved row must have isActive: false — existing active row untouched
    expect(userLanguageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
    // No update call that could flip other rows
    expect(userLanguageRepo.findOne).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: mockUserId, isActive: true } }),
    );
  });

  // --- No header fallback ---

  it('should attach context from isActive UserLanguage when no header provided', async () => {
    userLanguageRepo.findOne.mockResolvedValue({
      userId: mockUserId,
      languageId: mockLangEn.id,
      isActive: true,
      language: { id: mockLangEn.id, code: mockLangEn.code },
    });

    const ctx = makeContext({ user: { id: mockUserId } });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    const request = ctx.switchToHttp().getRequest() as any;
    expect(request.activeLanguage).toEqual(mockLangEn);
  });

  it('should throw BadRequestException when no header and no active UserLanguage', async () => {
    userLanguageRepo.findOne.mockResolvedValue(null);

    const ctx = makeContext({ user: { id: mockUserId } });

    await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
  });

  it('should throw BadRequestException for anonymous requests with no header', async () => {
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
  });
});
