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

const entities = [
  Language,
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
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('database.url'),
        ssl: {
          rejectUnauthorized: false,
        },
        extra: {
          max: 10,
          min: 2,
          idleTimeoutMillis: 30000,
        },
        entities,
        synchronize: false,
        logging: configService.get<string>('nodeEnv') === 'development',
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DatabaseModule {}
