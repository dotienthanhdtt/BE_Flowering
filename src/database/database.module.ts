import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Language } from './entities/language.entity';
import { User } from './entities/user.entity';
import { UserLanguage } from './entities/user-language.entity';
import { Lesson } from './entities/lesson.entity';
import { Exercise } from './entities/exercise.entity';
import { UserProgress } from './entities/user-progress.entity';
import { UserExerciseAttempt } from './entities/user-exercise-attempt.entity';
import { Subscription } from './entities/subscription.entity';
import { AiConversation } from './entities/ai-conversation.entity';
import { AiConversationMessage } from './entities/ai-conversation-message.entity';
import { DeviceToken } from './entities/device-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordReset } from './entities/password-reset.entity';
import { Vocabulary } from './entities/vocabulary.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { ScenarioCategory } from './entities/scenario-category.entity';
import { Scenario } from './entities/scenario.entity';
import { UserScenarioAccess } from './entities/user-scenario-access.entity';
import { KolBundle } from './entities/kol-bundle.entity';
import { KolBundleScenario } from './entities/kol-bundle-scenario.entity';
import { VocabularyInjectionEvent } from './entities/vocabulary-injection-event.entity';
import { FrameworkLevel } from './entities/framework-level.entity';
import { ScenarioEvaluation } from './entities/scenario-evaluation.entity';

const entities = [
  Language,
  FrameworkLevel,
  User,
  UserLanguage,
  Lesson,
  Exercise,
  UserProgress,
  UserExerciseAttempt,
  Subscription,
  AiConversation,
  AiConversationMessage,
  DeviceToken,
  RefreshToken,
  PasswordReset,
  Vocabulary,
  WebhookEvent,
  ScenarioCategory,
  Scenario,
  UserScenarioAccess,
  KolBundle,
  KolBundleScenario,
  VocabularyInjectionEvent,
  ScenarioEvaluation,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('database.url');
        // Railway-managed Postgres (internal network or TCP proxy) does not serve
        // TLS; only enable SSL for externally hosted databases.
        const requiresSsl = !!url && !/\.railway\.internal|\.rlwy\.net/.test(url);
        return {
          type: 'postgres' as const,
          url,
          ssl: requiresSsl ? { rejectUnauthorized: false } : false,
          extra: {
            max: 10,
            min: 2,
            idleTimeoutMillis: 30000,
          },
          entities,
          synchronize: false,
          logging: false,
        };
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
