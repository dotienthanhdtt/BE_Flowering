import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vocabulary } from '../../database/entities/vocabulary.entity';
import { VocabularyController } from './vocabulary.controller';
import { VocabularyReviewController } from './vocabulary-review.controller';
import { VocabularyService } from './services/vocabulary.service';
import { VocabularyReviewService } from './services/vocabulary-review.service';
import { ReviewSessionStore } from './services/review-session-store';

/**
 * VocabularyModule — CRUD endpoints (`/vocabulary`) plus Leitner-based
 * review sessions (`/vocabulary/review/*`).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Vocabulary])],
  controllers: [VocabularyController, VocabularyReviewController],
  providers: [VocabularyService, VocabularyReviewService, ReviewSessionStore],
  exports: [VocabularyService],
})
export class VocabularyModule {}
