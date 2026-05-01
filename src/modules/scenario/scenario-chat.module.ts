import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AiConversation } from '@/database/entities/ai-conversation.entity';
import { AiConversationMessage } from '@/database/entities/ai-conversation-message.entity';
import { Scenario } from '@/database/entities/scenario.entity';
import { UserAiScenario } from '@/database/entities/user-ai-scenario.entity';
import { User } from '@/database/entities/user.entity';
import { UserScenarioAccess } from '@/database/entities/user-scenario-access.entity';
import { Vocabulary } from '@/database/entities/vocabulary.entity';
import { VocabularyInjectionEvent } from '@/database/entities/vocabulary-injection-event.entity';
import { AiModule } from '@/modules/ai/ai.module';
import { LanguageModule } from '@/modules/language/language.module';
import { SubscriptionModule } from '@/modules/subscription/subscription.module';
import { VocabularyModule } from '@/modules/vocabulary/vocabulary.module';
import { ScenarioChatController } from './scenario-chat.controller';
import { ScenarioChatService } from './services/scenario-chat.service';
import { ScenarioAccessService } from './services/scenario-access.service';
import { VocabularyInjectionService } from './services/vocabulary-injection.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiConversation,
      AiConversationMessage,
      Scenario,
      UserAiScenario,
      User,
      UserScenarioAccess,
      Vocabulary,
      VocabularyInjectionEvent,
    ]),
    ThrottlerModule.forRoot([
      { name: 'ai-short', ttl: 60_000, limit: 20 },
      { name: 'ai-medium', ttl: 3_600_000, limit: 100 },
    ]),
    AiModule,
    LanguageModule,
    SubscriptionModule,
    VocabularyModule,
  ],
  controllers: [ScenarioChatController],
  providers: [ScenarioChatService, ScenarioAccessService, VocabularyInjectionService],
})
export class ScenarioChatModule {}
