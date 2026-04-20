import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { KolBundle } from '@/database/entities/kol-bundle.entity';
import { KolBundleScenario } from '@/database/entities/kol-bundle-scenario.entity';
import { Scenario } from '@/database/entities/scenario.entity';
import { User } from '@/database/entities/user.entity';
import { CreateKolBundleDto } from './dto/create-kol-bundle.dto';
import { AttachScenariosDto } from './dto/attach-scenarios.dto';
import { ListKolBundlesQueryDto } from './dto/list-kol-bundles-query.dto';
import { KolBundleResponseDto } from './dto/kol-bundle-response.dto';

@Injectable()
export class KolBundleService {
  constructor(
    @InjectRepository(KolBundle)
    private readonly bundleRepo: Repository<KolBundle>,
    @InjectRepository(KolBundleScenario)
    private readonly bundleScenarioRepo: Repository<KolBundleScenario>,
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  private async validateCreator(creatorId: string): Promise<void> {
    const creator = await this.userRepo.findOne({ where: { id: creatorId } });
    if (!creator) throw new BadRequestException('Creator not found');
    if (!creator.roles.includes('kol')) {
      throw new BadRequestException('Creator must have kol role');
    }
  }

  private async validateScenarios(scenarioIds: string[]): Promise<void> {
    const count = await this.scenarioRepo.count({ where: { id: In(scenarioIds) } });
    if (count !== scenarioIds.length) {
      throw new BadRequestException('One or more scenarios not found');
    }
  }

  private async assertNoExistingAttachments(scenarioIds: string[]): Promise<void> {
    const existing = await this.bundleScenarioRepo.count({
      where: { scenarioId: In(scenarioIds) },
    });
    if (existing > 0) {
      throw new ConflictException('One or more scenarios already attached to a bundle');
    }
  }

  async create(dto: CreateKolBundleDto): Promise<KolBundleResponseDto> {
    await this.validateCreator(dto.creatorId);
    await this.validateScenarios(dto.scenarioIds);
    await this.assertNoExistingAttachments(dto.scenarioIds);

    try {
      return await this.dataSource.transaction(async (mgr) => {
        const bundle = mgr.create(KolBundle, {
          giftCode: dto.giftCode,
          creatorId: dto.creatorId,
          title: dto.title,
          description: dto.description,
        });
        const saved = await mgr.save(KolBundle, bundle);
        const rows = dto.scenarioIds.map((sid) =>
          mgr.create(KolBundleScenario, { bundleId: saved.id, scenarioId: sid }),
        );
        await mgr.save(KolBundleScenario, rows);
        return { ...saved, scenarioIds: dto.scenarioIds } as KolBundleResponseDto;
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === '23505') {
        throw new ConflictException('Duplicate gift code or scenario already attached to a bundle');
      }
      throw err;
    }
  }

  async list(
    query: ListKolBundlesQueryDto,
  ): Promise<{ items: KolBundleResponseDto[]; total: number }> {
    const qb = this.bundleRepo.createQueryBuilder('b');
    if (query.giftCode) {
      qb.where('b.gift_code = :code', { code: query.giftCode.trim().toUpperCase() });
    }
    const [bundles, total] = await qb
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    const allScenarioRows = bundles.length
      ? await this.bundleScenarioRepo.find({
          where: { bundleId: In(bundles.map((b) => b.id)) },
        })
      : [];

    const scenarioMap = new Map<string, string[]>();
    for (const row of allScenarioRows) {
      const arr = scenarioMap.get(row.bundleId) ?? [];
      arr.push(row.scenarioId);
      scenarioMap.set(row.bundleId, arr);
    }

    const items: KolBundleResponseDto[] = bundles.map((b) => ({
      id: b.id,
      giftCode: b.giftCode,
      creatorId: b.creatorId,
      title: b.title,
      description: b.description,
      scenarioIds: scenarioMap.get(b.id) ?? [],
      createdAt: b.createdAt,
    }));

    return { items, total };
  }

  async attachScenarios(bundleId: string, dto: AttachScenariosDto): Promise<KolBundleResponseDto> {
    const bundle = await this.bundleRepo.findOne({ where: { id: bundleId } });
    if (!bundle) throw new NotFoundException('Bundle not found');

    await this.validateScenarios(dto.scenarioIds);

    const conflicts = await this.bundleScenarioRepo.find({
      where: { scenarioId: In(dto.scenarioIds) },
    });
    if (conflicts.length > 0) {
      throw new ConflictException('One or more scenarios already attached to a bundle');
    }

    try {
      await this.dataSource.transaction(async (mgr) => {
        const rows = dto.scenarioIds.map((sid) =>
          mgr.create(KolBundleScenario, { bundleId, scenarioId: sid }),
        );
        await mgr.save(KolBundleScenario, rows);
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).code === '23505') {
        throw new ConflictException('One or more scenarios already attached to a bundle');
      }
      throw err;
    }

    const allRows = await this.bundleScenarioRepo.find({ where: { bundleId } });
    return {
      id: bundle.id,
      giftCode: bundle.giftCode,
      creatorId: bundle.creatorId,
      title: bundle.title,
      description: bundle.description,
      scenarioIds: allRows.map((r) => r.scenarioId),
      createdAt: bundle.createdAt,
    };
  }
}
