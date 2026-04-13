import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vocabulary } from '../../../database/entities/vocabulary.entity';
import { VocabularyQueryDto } from '../dto/vocabulary-query.dto';
import { VocabularyItemDto, VocabularyListDto } from '../dto/vocabulary-response.dto';

@Injectable()
export class VocabularyService {
  constructor(
    @InjectRepository(Vocabulary)
    private readonly repo: Repository<Vocabulary>,
  ) {}

  async list(userId: string, q: VocabularyQueryDto): Promise<VocabularyListDto> {
    const qb = this.repo.createQueryBuilder('v').where('v.userId = :userId', { userId });

    if (q.languageCode) {
      qb.andWhere('v.targetLang = :lang', { lang: q.languageCode });
    }
    if (q.box !== undefined) {
      qb.andWhere('v.box = :box', { box: q.box });
    }
    if (q.search) {
      qb.andWhere('(v.word ILIKE :s OR v.translation ILIKE :s)', { s: `%${q.search}%` });
    }

    qb.orderBy('v.createdAt', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async findOne(userId: string, id: string): Promise<VocabularyItemDto> {
    const row = await this.repo.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException('Vocabulary not found');
    return this.toDto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const res = await this.repo.delete({ id, userId });
    if (!res.affected) throw new NotFoundException('Vocabulary not found');
  }

  private toDto(v: Vocabulary): VocabularyItemDto {
    return {
      id: v.id,
      word: v.word,
      translation: v.translation,
      sourceLang: v.sourceLang,
      targetLang: v.targetLang,
      partOfSpeech: v.partOfSpeech,
      pronunciation: v.pronunciation,
      definition: v.definition,
      examples: v.examples,
      box: v.box,
      dueAt: v.dueAt,
      lastReviewedAt: v.lastReviewedAt ?? null,
      reviewCount: v.reviewCount,
      correctCount: v.correctCount,
      createdAt: v.createdAt,
    };
  }
}
