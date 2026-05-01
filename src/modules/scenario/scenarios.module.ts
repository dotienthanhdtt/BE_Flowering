import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { Scenario } from '@/database/entities/scenario.entity';
import { UserScenarioAccess } from '@/database/entities/user-scenario-access.entity';
import { UserLanguage } from '@/database/entities/user-language.entity';
import { KolBundle } from '@/database/entities/kol-bundle.entity';
import { KolBundleScenario } from '@/database/entities/kol-bundle-scenario.entity';
import { SubscriptionModule } from '@/modules/subscription/subscription.module';
import { ScenariosController } from './scenarios.controller';
import { ScenariosListingService } from './services/scenarios-listing.service';
import { ScenariosRedeemService } from './services/scenarios-redeem.service';
import { ScenarioAccessService } from './services/scenario-access.service';
import { ScenariosDetailService } from './services/scenarios-detail.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Scenario,
      UserScenarioAccess,
      UserLanguage,
      KolBundle,
      KolBundleScenario,
    ]),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 5 }]),
    SubscriptionModule,
  ],
  controllers: [ScenariosController],
  providers: [
    ScenariosListingService,
    ScenariosRedeemService,
    ScenarioAccessService,
    ScenariosDetailService,
  ],
})
export class ScenariosModule {}
