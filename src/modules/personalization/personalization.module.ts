import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiConversation, AiConversationMessage, User } from '@/database/entities';
import { Scenario } from '@/database/entities/scenario.entity';
import { AiModule } from '@/modules/ai/ai.module';
import { LanguageModule } from '@/modules/language/language.module';
import { SubscriptionModule } from '@/modules/subscription/subscription.module';
import { PersonalizationController } from './personalization.controller';
import { PersonalizationService } from './services/personalization.service';
import { PersonalizationQuotaService } from './services/personalization-quota.service';
import { PersonalizationDedupService } from './services/personalization-dedup.service';
import { PersonalizationPruneService } from './services/personalization-prune.service';
import { PersonalizationTriggerService } from './services/personalization-trigger.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiConversation, AiConversationMessage, Scenario, User]),
    AiModule,
    LanguageModule,
    SubscriptionModule,
  ],
  controllers: [PersonalizationController],
  providers: [
    PersonalizationService,
    PersonalizationQuotaService,
    PersonalizationDedupService,
    PersonalizationPruneService,
    PersonalizationTriggerService,
  ],
  exports: [PersonalizationTriggerService],
})
export class PersonalizationModule {}
