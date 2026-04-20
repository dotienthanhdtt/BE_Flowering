import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { Scenario } from '@/database/entities/scenario.entity';
import { UserAiScenario } from '@/database/entities/user-ai-scenario.entity';
import { UserScenarioAccess } from '@/database/entities/user-scenario-access.entity';
import { KolBundle } from '@/database/entities/kol-bundle.entity';
import { KolBundleScenario } from '@/database/entities/kol-bundle-scenario.entity';
import { ScenariosController } from './scenarios.controller';
import { ScenariosListingService } from './services/scenarios-listing.service';
import { ScenariosRedeemService } from './services/scenarios-redeem.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Scenario,
      UserAiScenario,
      UserScenarioAccess,
      KolBundle,
      KolBundleScenario,
    ]),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 5 }]),
  ],
  controllers: [ScenariosController],
  providers: [ScenariosListingService, ScenariosRedeemService],
})
export class ScenariosModule {}
