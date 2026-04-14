import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AiConversation, AiConversationMessage } from '../../database/entities';
import { AiModule } from '../ai/ai.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { OnboardingThrottlerGuard } from './onboarding-throttler.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiConversation, AiConversationMessage]),
    AiModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 3600_000, // 1 hour
        limit: 30, // 30 req/hour/IP across onboarding
      },
    ]),
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingThrottlerGuard],
  exports: [OnboardingService],
})
export class OnboardingModule {}
