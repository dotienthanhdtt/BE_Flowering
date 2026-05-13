import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AiConversation } from '@/database/entities/ai-conversation.entity';
import { AiConversationMessage } from '@/database/entities/ai-conversation-message.entity';
import { Scenario } from '@/database/entities/scenario.entity';
import { User } from '@/database/entities/user.entity';
import { UserScenarioAccess } from '@/database/entities/user-scenario-access.entity';
import { Vocabulary } from '@/database/entities/vocabulary.entity';
import { VocabularyInjectionEvent } from '@/database/entities/vocabulary-injection-event.entity';
import { ScenarioEvaluation } from '@/database/entities/scenario-evaluation.entity';
import { AiModule } from '@/modules/ai/ai.module';
import { LanguageModule } from '@/modules/language/language.module';
import { SubscriptionModule } from '@/modules/subscription/subscription.module';
import { VocabularyModule } from '@/modules/vocabulary/vocabulary.module';
import { AccessTierCacheService } from '@common/services/access-tier-cache.service';
import { ResourceAccessGuard } from '@common/guards/resource-access.guard';
import { PersonalizationModule } from '@/modules/personalization/personalization.module';
import { ScenarioChatController } from './scenario-chat.controller';
import { ScenarioChatService } from './services/scenario-chat.service';
import { ScenarioAccessService } from './services/scenario-access.service';
import { VocabularyInjectionService } from './services/vocabulary-injection.service';
import { ScenarioCompleteService } from './services/scenario-complete.service';
import { ScenarioEvaluatorService } from './services/scenario-evaluator.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiConversation,
      AiConversationMessage,
      Scenario,
      User,
      UserScenarioAccess,
      Vocabulary,
      VocabularyInjectionEvent,
      ScenarioEvaluation,
    ]),
    ThrottlerModule.forRoot([
      { name: 'ai-short', ttl: 60_000, limit: 20 },
      { name: 'ai-medium', ttl: 3_600_000, limit: 100 },
      { name: 'scenario-complete', ttl: 60_000, limit: 30 },
    ]),
    AiModule,
    LanguageModule,
    SubscriptionModule,
    VocabularyModule,
    PersonalizationModule,
  ],
  controllers: [ScenarioChatController],
  providers: [
    ScenarioChatService,
    ScenarioAccessService,
    VocabularyInjectionService,
    ScenarioCompleteService,
    ScenarioEvaluatorService,
    AccessTierCacheService,
    ResourceAccessGuard,
  ],
})
export class ScenarioChatModule {}
