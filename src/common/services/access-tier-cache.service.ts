import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Scenario } from '@/database/entities/scenario.entity';
import { AccessTier } from '@/database/entities/access-tier.enum';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  tier: AccessTier;
  expiresAt: number;
}

export type ResourceType = 'scenario';

/**
 * In-memory TTL cache for resource access tiers.
 * Keyed by `${resource}:${id}` — safe across users (tier is per-resource, not per-user).
 * TTL: 5 min. No Redis dependency.
 */
@Injectable()
export class AccessTierCacheService {
  private readonly logger = new Logger(AccessTierCacheService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
  ) {}

  /**
   * Returns the access tier for the given resource, using cache when valid.
   * Returns null if the resource is not found.
   */
  async get(resource: ResourceType, id: string): Promise<AccessTier | null> {
    const key = `${resource}:${id}`;
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > now) {
      return cached.tier;
    }

    const tier = await this.fetchFromDb(resource, id);
    if (tier === null) return null;

    this.evictExpired(now);
    this.cache.set(key, { tier, expiresAt: now + CACHE_TTL_MS });
    this.logger.debug(`Cached access tier ${tier} for ${key}`);
    return tier;
  }

  /** Invalidate a specific entry (e.g. after admin update). */
  invalidate(resource: ResourceType, id: string): void {
    this.cache.delete(`${resource}:${id}`);
  }

  private async fetchFromDb(resource: ResourceType, id: string): Promise<AccessTier | null> {
    if (resource === 'scenario') {
      const scenario = await this.scenarioRepo.findOne({
        where: { id },
        select: ['id', 'accessTier'],
      });
      return scenario?.accessTier ?? null;
    }
    return null;
  }

  private evictExpired(now: number): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }
}
