import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vocabulary } from '@/database/entities/vocabulary.entity';
import { VOCAB_INJECTION_CONFIG } from '../config/vocab-injection.config';

@Injectable()
export class VocabularyInjectionService {
  constructor(
    @InjectRepository(Vocabulary)
    private readonly repo: Repository<Vocabulary>,
  ) {}

  async selectVocabularyForConversation(userId: string, targetLang: string): Promise<Vocabulary[]> {
    const [recent, due] = await Promise.all([
      this.queryRotationBucket(userId, targetLang),
      this.querySrsBucket(userId, targetLang),
    ]);
    const seen = new Set(recent.map((v) => v.id));
    const merged = [...recent];
    for (const v of due) {
      if (!seen.has(v.id)) {
        merged.push(v);
        seen.add(v.id);
      }
    }
    return merged.slice(0, VOCAB_INJECTION_CONFIG.totalWords);
  }

  async hydrateByIds(ids: string[]): Promise<Vocabulary[]> {
    if (!ids?.length) return [];
    const rows = await this.repo
      .createQueryBuilder('v')
      .where('v.id = ANY(:ids)', { ids })
      .getMany();
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((v): v is Vocabulary => !!v);
  }

  private queryRotationBucket(userId: string, lang: string): Promise<Vocabulary[]> {
    return this.repo
      .createQueryBuilder('v')
      .where('v.userId = :userId', { userId })
      .andWhere('v.sourceLang = :lang', { lang })
      .andWhere('v.box < 5')
      .orderBy('v.lastReviewedAt', 'ASC', 'NULLS FIRST')
      .limit(VOCAB_INJECTION_CONFIG.recentBucketSize)
      .getMany();
  }

  private querySrsBucket(userId: string, lang: string): Promise<Vocabulary[]> {
    return this.repo
      .createQueryBuilder('v')
      .where('v.userId = :userId', { userId })
      .andWhere('v.sourceLang = :lang', { lang })
      .andWhere('v.dueAt <= NOW()')
      .andWhere('v.box <= :maxBox', { maxBox: VOCAB_INJECTION_CONFIG.maxBoxForSrs })
      .orderBy('v.correctCount', 'ASC')
      .addOrderBy('v.dueAt', 'ASC')
      .limit(VOCAB_INJECTION_CONFIG.srsBucketSize)
      .getMany();
  }
}
