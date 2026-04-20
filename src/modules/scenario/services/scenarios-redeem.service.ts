import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Scenario } from '@/database/entities/scenario.entity';
import { KolBundle } from '@/database/entities/kol-bundle.entity';
import { KolBundleScenario } from '@/database/entities/kol-bundle-scenario.entity';
import { UserScenarioAccess } from '@/database/entities/user-scenario-access.entity';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { RedeemedScenarioItemDto } from '../dto/redeem-scenario.dto';

@Injectable()
export class ScenariosRedeemService {
  constructor(
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(KolBundle)
    private readonly kolBundleRepo: Repository<KolBundle>,
    @InjectRepository(KolBundleScenario)
    private readonly kolBundleScenarioRepo: Repository<KolBundleScenario>,
    @InjectRepository(UserScenarioAccess)
    private readonly userScenarioAccessRepo: Repository<UserScenarioAccess>,
  ) {}

  async redeem(
    userId: string,
    giftCode: string,
  ): Promise<{ scenarios: RedeemedScenarioItemDto[] }> {
    const bundle = await this.kolBundleRepo.findOne({ where: { giftCode } });
    if (!bundle) throw new NotFoundException('Gift code not found');

    const bundleScenarios = await this.kolBundleScenarioRepo.find({
      where: { bundleId: bundle.id },
    });
    if (!bundleScenarios.length) throw new NotFoundException('Bundle has no scenarios');

    const scenarioIds = bundleScenarios.map((bs) => bs.scenarioId);

    await this.userScenarioAccessRepo
      .createQueryBuilder()
      .insert()
      .into(UserScenarioAccess)
      .values(scenarioIds.map((sid) => ({ userId, scenarioId: sid })))
      .orIgnore()
      .execute();

    const scenarios = await this.scenarioRepo.find({
      where: { id: In(scenarioIds), status: ContentStatus.PUBLISHED },
    });

    return {
      scenarios: scenarios.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        difficulty: s.difficulty,
        languageId: s.languageId,
      })),
    };
  }
}
