import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Language } from '@/database/entities/language.entity';
import { ActiveLanguageContext } from '@common/decorators/active-language.decorator';

const CACHE_TTL_MS = 60_000;
const MAX_ENTRIES = 20;

interface CacheEntry {
  value: ActiveLanguageContext;
  expiresAt: number;
}

@Injectable()
export class LanguageContextCacheService {
  private readonly logger = new Logger(LanguageContextCacheService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectRepository(Language)
    private readonly languageRepo: Repository<Language>,
  ) {}

  async resolve(code: string): Promise<ActiveLanguageContext | null> {
    const now = Date.now();
    const cached = this.cache.get(code);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const language = await this.languageRepo.findOne({
      where: { code, isActive: true },
      select: ['id', 'code'],
    });

    if (!language) {
      this.logger.warn(`Language code "${code}" not found or inactive`);
      return null;
    }

    this.evictExpired(now);
    if (this.cache.size >= MAX_ENTRIES) {
      // evict oldest entry
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }

    const entry: CacheEntry = {
      value: { id: language.id, code: language.code },
      expiresAt: now + CACHE_TTL_MS,
    };
    this.cache.set(code, entry);
    return entry.value;
  }

  invalidate(code?: string): void {
    if (code) {
      this.cache.delete(code);
    } else {
      this.cache.clear();
    }
  }

  private evictExpired(now: number): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }
}
