import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { Language } from '@/database/entities/language.entity';
import { Lesson } from '@/database/entities/lesson.entity';
import { Exercise } from '@/database/entities/exercise.entity';
import { Scenario } from '@/database/entities/scenario.entity';
import { User } from '@/database/entities/user.entity';
import { AiModule } from '@/modules/ai/ai.module';
import { AdminContentController } from './admin-content.controller';
import { AdminContentService } from './admin-content.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Language, Lesson, Exercise, Scenario, User]),
    AiModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 5,
      },
    ]),
  ],
  controllers: [AdminContentController],
  providers: [AdminContentService],
})
export class AdminContentModule {}
