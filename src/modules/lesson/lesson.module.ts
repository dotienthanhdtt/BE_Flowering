import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LessonController } from './lesson.controller';
import { LessonService } from './lesson.service';
import { Scenario } from '../../database/entities/scenario.entity';
import { ScenarioCategory } from '../../database/entities/scenario-category.entity';
import { UserScenarioAccess } from '../../database/entities/user-scenario-access.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Scenario, ScenarioCategory, UserScenarioAccess, Subscription]),
    SubscriptionModule,
  ],
  controllers: [LessonController],
  providers: [LessonService],
  exports: [LessonService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class LessonModule {}
