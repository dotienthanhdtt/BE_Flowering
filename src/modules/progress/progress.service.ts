import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProgress, ProgressStatus } from '@/database/entities/user-progress.entity';
import { UserExerciseAttempt } from '@/database/entities/user-exercise-attempt.entity';

@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(UserProgress)
    private readonly progressRepo: Repository<UserProgress>,
    @InjectRepository(UserExerciseAttempt)
    private readonly attemptRepo: Repository<UserExerciseAttempt>,
  ) {}

  async upsertProgress(
    userId: string,
    languageId: string,
    lessonId: string,
    patch: Partial<Pick<UserProgress, 'status' | 'scoreEarned' | 'exercisesCompleted' | 'exercisesTotal' | 'completedAt'>>,
  ): Promise<UserProgress> {
    const existing = await this.progressRepo.findOne({ where: { userId, lessonId } });

    if (existing) {
      if (existing.languageId !== languageId) {
        throw new ForbiddenException('Progress record belongs to a different language');
      }
      Object.assign(existing, patch);
      if (patch.status === ProgressStatus.COMPLETED && !existing.completedAt) {
        existing.completedAt = new Date();
      }
      return this.progressRepo.save(existing);
    }

    const created = this.progressRepo.create({ userId, languageId, lessonId, ...patch });
    return this.progressRepo.save(created);
  }

  async recordAttempt(
    userId: string,
    languageId: string,
    exerciseId: string,
    userAnswer: Record<string, unknown>,
    isCorrect: boolean,
    pointsEarned: number,
    timeSpentSeconds?: number,
  ): Promise<UserExerciseAttempt> {
    return this.attemptRepo.save(
      this.attemptRepo.create({
        userId,
        languageId,
        exerciseId,
        userAnswer,
        isCorrect,
        pointsEarned,
        timeSpentSeconds,
      }),
    );
  }

  async getProgressByLanguage(userId: string, languageId: string): Promise<UserProgress[]> {
    return this.progressRepo.find({ where: { userId, languageId } });
  }
}
