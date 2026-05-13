import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Scenario } from '@/database/entities/scenario.entity';
import { OnboardingMaterializationService } from './services/onboarding-materialization.service';

@Module({
  imports: [TypeOrmModule.forFeature([Scenario])],
  providers: [OnboardingMaterializationService],
  exports: [OnboardingMaterializationService],
})
export class ScenarioMaterializationModule {}
