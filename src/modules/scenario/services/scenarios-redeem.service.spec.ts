import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ScenariosRedeemService } from './scenarios-redeem.service';
import { Scenario, ScenarioDifficulty } from '@/database/entities/scenario.entity';
import { KolBundle } from '@/database/entities/kol-bundle.entity';
import { KolBundleScenario } from '@/database/entities/kol-bundle-scenario.entity';
import { UserScenarioAccess } from '@/database/entities/user-scenario-access.entity';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { ScenarioType } from '@/database/entities/scenario-type.enum';

describe('ScenariosRedeemService', () => {
  let service: ScenariosRedeemService;
  let scenarioRepo: jest.Mocked<Repository<Scenario>>;
  let kolBundleRepo: jest.Mocked<Repository<KolBundle>>;
  let kolBundleScenarioRepo: jest.Mocked<Repository<KolBundleScenario>>;
  let userScenarioAccessRepo: jest.Mocked<Repository<UserScenarioAccess>>;

  const mockScenario = (id: string): Scenario => ({
    id,
    type: ScenarioType.KOL,
    title: `KOL Scenario ${id}`,
    description: `Description for KOL ${id}`,
    difficulty: ScenarioDifficulty.INTERMEDIATE,
    languageId: 'lang-1',
    categoryId: 'cat-1',
    status: ContentStatus.PUBLISHED,
    orderIndex: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Scenario);

  const mockKolBundle = (giftCode: string): KolBundle => ({
    id: 'bundle-1',
    giftCode,
    title: `Bundle for ${giftCode}`,
    description: 'Test bundle',
    createdAt: new Date(),
  } as KolBundle);

  const mockBundleScenario = (bundleId: string, scenarioId: string): KolBundleScenario =>
    ({ bundleId, scenarioId } as KolBundleScenario);

  const mockQueryBuilder = () => ({
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ identifiers: [], generatedMaps: [], raw: [] }),
  } as unknown as SelectQueryBuilder<UserScenarioAccess>);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenariosRedeemService,
        {
          provide: getRepositoryToken(Scenario),
          useValue: {
            find: jest.fn(),
          } as unknown as Repository<Scenario>,
        },
        {
          provide: getRepositoryToken(KolBundle),
          useValue: {
            findOne: jest.fn(),
          } as unknown as Repository<KolBundle>,
        },
        {
          provide: getRepositoryToken(KolBundleScenario),
          useValue: {
            find: jest.fn(),
          } as unknown as Repository<KolBundleScenario>,
        },
        {
          provide: getRepositoryToken(UserScenarioAccess),
          useValue: {
            createQueryBuilder: jest.fn(),
          } as unknown as Repository<UserScenarioAccess>,
        },
      ],
    }).compile();

    service = module.get(ScenariosRedeemService);
    scenarioRepo = module.get(getRepositoryToken(Scenario));
    kolBundleRepo = module.get(getRepositoryToken(KolBundle));
    kolBundleScenarioRepo = module.get(getRepositoryToken(KolBundleScenario));
    userScenarioAccessRepo = module.get(getRepositoryToken(UserScenarioAccess));
  });

  describe('redeem', () => {
    it('returns scenarios on valid gift code', async () => {
      jest.spyOn(kolBundleRepo, 'findOne').mockResolvedValue(mockKolBundle('CODE'));
      jest.spyOn(kolBundleScenarioRepo, 'find').mockResolvedValue([
        mockBundleScenario('b1', 'scenario-1'),
        mockBundleScenario('b1', 'scenario-2'),
      ]);
      jest.spyOn(userScenarioAccessRepo, 'createQueryBuilder').mockReturnValue(mockQueryBuilder());
      jest.spyOn(scenarioRepo, 'find').mockResolvedValue([mockScenario('scenario-1'), mockScenario('scenario-2')]);

      const result = await service.redeem('user-1', 'CODE');

      expect(result.scenarios).toHaveLength(2);
      expect(result.scenarios[0].id).toBe('scenario-1');
    });

    it('throws NotFoundException when bundle not found', async () => {
      jest.spyOn(kolBundleRepo, 'findOne').mockResolvedValue(null);

      await expect(service.redeem('user-1', 'INVALID-CODE')).rejects.toThrow(NotFoundException);
      await expect(service.redeem('user-1', 'INVALID-CODE')).rejects.toThrow('Gift code not found');
    });

    it('throws NotFoundException when bundle has no scenarios', async () => {
      const bundle = mockKolBundle('EMPTY-BUNDLE');
      jest.spyOn(kolBundleRepo, 'findOne').mockResolvedValue(bundle);
      jest.spyOn(kolBundleScenarioRepo, 'find').mockResolvedValue([]);

      await expect(service.redeem('user-1', 'EMPTY-BUNDLE')).rejects.toThrow(NotFoundException);
      await expect(service.redeem('user-1', 'EMPTY-BUNDLE')).rejects.toThrow('Bundle has no scenarios');
    });

    it('is idempotent - re-redeem returns same scenarios', async () => {
      jest.spyOn(kolBundleRepo, 'findOne').mockResolvedValue(mockKolBundle('CODE'));
      jest.spyOn(kolBundleScenarioRepo, 'find').mockResolvedValue([mockBundleScenario('b1', 's1')]);
      jest.spyOn(userScenarioAccessRepo, 'createQueryBuilder').mockReturnValue(mockQueryBuilder());
      jest.spyOn(scenarioRepo, 'find').mockResolvedValue([mockScenario('s1')]);

      const r1 = await service.redeem('user-1', 'CODE');
      const r2 = await service.redeem('user-1', 'CODE');

      expect(r1.scenarios).toEqual(r2.scenarios);
    });

    it('inserts user scenario access with orIgnore for idempotency', async () => {
      jest.spyOn(kolBundleRepo, 'findOne').mockResolvedValue(mockKolBundle('CODE'));
      jest.spyOn(kolBundleScenarioRepo, 'find').mockResolvedValue([mockBundleScenario('b1', 's1')]);
      const qb = mockQueryBuilder() as any;
      jest.spyOn(userScenarioAccessRepo, 'createQueryBuilder').mockReturnValue(qb);
      jest.spyOn(scenarioRepo, 'find').mockResolvedValue([mockScenario('s1')]);

      await service.redeem('user-1', 'CODE');

      expect(qb.values).toHaveBeenCalledWith([{ userId: 'user-1', scenarioId: 's1' }]);
      expect(qb.orIgnore).toHaveBeenCalled();
    });

    it('filters scenarios by PUBLISHED status', async () => {
      jest.spyOn(kolBundleRepo, 'findOne').mockResolvedValue(mockKolBundle('CODE'));
      jest.spyOn(kolBundleScenarioRepo, 'find').mockResolvedValue([mockBundleScenario('b1', 's1'), mockBundleScenario('b1', 's2')]);
      jest.spyOn(userScenarioAccessRepo, 'createQueryBuilder').mockReturnValue(mockQueryBuilder());
      jest.spyOn(scenarioRepo, 'find').mockResolvedValue([mockScenario('s1')]);

      const result = await service.redeem('user-1', 'CODE');

      expect(scenarioRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: ContentStatus.PUBLISHED }) }));
      expect(result.scenarios).toHaveLength(1);
    });
  });
});
