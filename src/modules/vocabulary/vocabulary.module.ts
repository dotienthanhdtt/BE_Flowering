import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vocabulary } from '../../database/entities/vocabulary.entity';
import { VocabularyController } from './vocabulary.controller';
import { VocabularyService } from './services/vocabulary.service';
import { VocabularyReviewService } from './services/vocabulary-review.service';
import { ReviewSessionStore } from './services/review-session-store';

/**
 * VocabularyModule — `GET /vocabulary` listing. `VocabularyReviewService`
 * is retained for internal use by scenario-chat persistence.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Vocabulary])],
  controllers: [VocabularyController],
  providers: [VocabularyService, VocabularyReviewService, ReviewSessionStore],
  exports: [VocabularyService, VocabularyReviewService],
})
export class VocabularyModule {}
