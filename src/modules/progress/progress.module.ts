import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserProgress } from '@/database/entities/user-progress.entity';
import { UserExerciseAttempt } from '@/database/entities/user-exercise-attempt.entity';
import { ProgressService } from './progress.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserProgress, UserExerciseAttempt])],
  providers: [ProgressService],
  exports: [ProgressService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ProgressModule {}
