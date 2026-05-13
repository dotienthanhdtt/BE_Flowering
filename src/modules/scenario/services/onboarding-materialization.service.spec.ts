import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { OnboardingMaterializationService } from './onboarding-materialization.service';
import { Scenario } from '@/database/entities/scenario.entity';
import { AiConversation } from '@/database/entities/ai-conversation.entity';

const makeConversation = (overrides: Partial<AiConversation> = {}): AiConversation =>
  ({
    id: 'conv-uuid',
    languageId: 'lang-en',
    scenarios: [
      { title: 'Scenario One', description: 'Desc 1' },
      { title: 'Scenario Two', description: 'Desc 2' },
      { title: 'Scenario Three', description: 'Desc 3' },
      { title: 'Scenario Four', description: 'Desc 4' },
      { title: 'Scenario Five', description: 'Desc 5' },
    ],
    ...overrides,
  }) as unknown as AiConversation;

const makeQueryBuilder = () => {
  const qb = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ identifiers: [], generatedMaps: [], raw: [] }),
  };
  return qb;
};

describe('OnboardingMaterializationService', () => {
  let service: OnboardingMaterializationService;
  let qb: ReturnType<typeof makeQueryBuilder>;
  let logWarnSpy: jest.SpyInstance;
  let logLogSpy: jest.SpyInstance;

  beforeEach(async () => {
    qb = makeQueryBuilder();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingMaterializationService,
        {
          provide: getRepositoryToken(Scenario),
          useValue: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
        },
      ],
    }).compile();

    service = module.get(OnboardingMaterializationService);
    logWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    logLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logWarnSpy.mockRestore();
    logLogSpy.mockRestore();
  });

  describe('happy path', () => {
    it('inserts 5 partials with orIgnore and logs success event', async () => {
      const conv = makeConversation();
      await service.materializeFromConversation('user-1', conv);

      expect(qb.values).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ ownerId: 'user-1', languageId: 'lang-en' })]),
      );
      expect(qb.orIgnore).toHaveBeenCalled();
      expect(qb.execute).toHaveBeenCalled();
      expect(logLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'onboarding.materialization.success', count: 5 }),
      );
    });

    it('sets orderIndex from array position (0-based)', async () => {
      await service.materializeFromConversation('user-1', makeConversation());
      const valuesArg: Array<{ orderIndex: number }> = qb.values.mock.calls[0][0];
      expect(valuesArg[0].orderIndex).toBe(0);
      expect(valuesArg[4].orderIndex).toBe(4);
    });

    it('tolerates extra fields in JSON (old shape with icon/accentColor/difficulty)', async () => {
      const conv = makeConversation({
        scenarios: [
          { id: 'sc-1', title: 'T1', description: 'D1', icon: 'star', accentColor: 'blue', difficulty: 'beginner' },
          { id: 'sc-2', title: 'T2', description: 'D2', icon: 'book', accentColor: 'green', difficulty: 'intermediate' },
          { id: 'sc-3', title: 'T3', description: 'D3' },
          { id: 'sc-4', title: 'T4', description: 'D4' },
          { id: 'sc-5', title: 'T5', description: 'D5' },
        ] as Record<string, unknown>[],
      });
      await service.materializeFromConversation('user-1', conv);
      expect(qb.execute).toHaveBeenCalled();
    });
  });

  describe('skip paths', () => {
    it('skips with skip.empty_json event when scenarios is null', async () => {
      const conv = makeConversation({ scenarios: null as unknown as [] });
      await service.materializeFromConversation('user-1', conv);
      expect(qb.execute).not.toHaveBeenCalled();
      expect(logWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'onboarding.materialization.skip.empty_json' }),
      );
    });

    it('skips with skip.bad_shape event when scenarios is empty array', async () => {
      const conv = makeConversation({ scenarios: [] as unknown as [] });
      await service.materializeFromConversation('user-1', conv);
      expect(qb.execute).not.toHaveBeenCalled();
      expect(logWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'onboarding.materialization.skip.bad_shape' }),
      );
    });

    it('skips with skip.bad_shape event when scenarios length != 5', async () => {
      const conv = makeConversation({
        scenarios: [{ title: 'only one' }] as unknown as [],
      });
      await service.materializeFromConversation('user-1', conv);
      expect(logWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'onboarding.materialization.skip.bad_shape', length: 1 }),
      );
    });

    it('skips with skip.no_language_id event when languageId is null', async () => {
      const conv = makeConversation({ languageId: null as unknown as string });
      await service.materializeFromConversation('user-1', conv);
      expect(qb.execute).not.toHaveBeenCalled();
      expect(logWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'onboarding.materialization.skip.no_language_id' }),
      );
    });

    it('skips with skip.all_titles_invalid event when all titles empty after sanitization', async () => {
      const conv = makeConversation({
        scenarios: [
          { id: '1', title: '', description: 'D1' },
          { id: '2', title: '<br/>', description: 'D2' },
          { id: '3', title: '   ', description: 'D3' },
          { id: '4', title: '', description: 'D4' },
          { id: '5', title: '', description: 'D5' },
        ] as Record<string, unknown>[],
      });
      await service.materializeFromConversation('user-1', conv);
      expect(qb.execute).not.toHaveBeenCalled();
      expect(logWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'onboarding.materialization.skip.all_titles_invalid' }),
      );
    });
  });

  describe('error handling', () => {
    it('catches DB errors and logs fail.db event without rethrowing', async () => {
      qb.execute.mockRejectedValue(new Error('connection lost'));
      const conv = makeConversation();

      await expect(service.materializeFromConversation('user-1', conv)).resolves.toBeUndefined();
      expect(logWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'onboarding.materialization.fail.db', error: 'connection lost' }),
      );
    });
  });
});
