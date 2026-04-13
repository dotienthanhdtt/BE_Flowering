import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vocabulary } from '../../../database/entities/vocabulary.entity';
import { ReviewStartDto, ReviewCardDto, ReviewStartResponseDto } from '../dto/review-start.dto';
import { ReviewRateDto, ReviewRateResponseDto } from '../dto/review-rate.dto';
import {
  BoxDistributionEntryDto,
  ReviewCompleteResponseDto,
} from '../dto/review-complete.dto';
import { applyLeitner } from './leitner';
import { ReviewSessionStore } from './review-session-store';

@Injectable()
export class VocabularyReviewService {
  constructor(
    @InjectRepository(Vocabulary)
    private readonly repo: Repository<Vocabulary>,
    private readonly store: ReviewSessionStore,
  ) {}

  async start(userId: string, dto: ReviewStartDto): Promise<ReviewStartResponseDto> {
    const limit = dto.limit ?? 20;
    const qb = this.repo
      .createQueryBuilder('v')
      .where('v.userId = :userId', { userId })
      .andWhere('v.dueAt <= NOW()');

    if (dto.languageCode) {
      qb.andWhere('v.targetLang = :lang', { lang: dto.languageCode });
    }

    const cards = await qb.orderBy('v.dueAt', 'ASC').limit(limit).getMany();
    const session = this.store.create(userId, cards.map((c) => c.id));

    return {
      sessionId: session.id,
      cards: cards.map((c) => this.toCardDto(c)),
      total: cards.length,
    };
  }

  async rate(
    userId: string,
    sessionId: string,
    dto: ReviewRateDto,
  ): Promise<ReviewRateResponseDto> {
    const session = this.store.get(sessionId, userId);

    if (!session.cardIds.includes(dto.vocabId)) {
      throw new BadRequestException('Card not in session');
    }
    if (session.ratings.has(dto.vocabId)) {
      throw new BadRequestException('Card already rated');
    }

    // Claim the slot before any async work to prevent concurrent double-rate.
    // If persistence fails below, we remove the entry so the card can be retried.
    session.ratings.set(dto.vocabId, dto.correct);

    const vocab = await this.repo.findOne({ where: { id: dto.vocabId, userId } });
    if (!vocab) {
      session.ratings.delete(dto.vocabId);
      throw new NotFoundException('Vocabulary not found');
    }

    let box: number;
    let dueAt: Date;
    try {
      ({ box, dueAt } = applyLeitner(vocab.box, dto.correct));
      vocab.box = box;
      vocab.dueAt = dueAt;
      vocab.lastReviewedAt = new Date();
      vocab.reviewCount += 1;
      if (dto.correct) vocab.correctCount += 1;
      await this.repo.save(vocab);
    } catch (err) {
      session.ratings.delete(dto.vocabId);
      throw err;
    }

    return {
      updated: { box, dueAt },
      remaining: session.cardIds.length - session.ratings.size,
    };
  }

  async complete(userId: string, sessionId: string): Promise<ReviewCompleteResponseDto> {
    const session = this.store.get(sessionId, userId);

    const total = session.ratings.size;
    const correct = Array.from(session.ratings.values()).filter((v) => v).length;
    const wrong = total - correct;
    const accuracy = total === 0 ? 0 : Math.round((correct / total) * 100);

    const rawDist = await this.repo
      .createQueryBuilder('v')
      .select('v.box', 'box')
      .addSelect('COUNT(*)', 'count')
      .where('v.userId = :userId', { userId })
      .groupBy('v.box')
      .orderBy('v.box', 'ASC')
      .getRawMany<{ box: number | string; count: number | string }>();

    const boxDistribution: BoxDistributionEntryDto[] = rawDist.map((r) => ({
      box: Number(r.box),
      count: Number(r.count),
    }));

    this.store.delete(sessionId);
    return { total, correct, wrong, accuracy, boxDistribution };
  }

  private toCardDto(v: Vocabulary): ReviewCardDto {
    return {
      vocabId: v.id,
      word: v.word,
      translation: v.translation,
      pronunciation: v.pronunciation,
      partOfSpeech: v.partOfSpeech,
      definition: v.definition,
      examples: v.examples,
      box: v.box,
      sourceLang: v.sourceLang,
      targetLang: v.targetLang,
    };
  }
}
