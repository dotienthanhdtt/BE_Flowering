import { Scenario } from '@/database/entities/scenario.entity';
import { ScenarioType } from '@/database/entities/scenario-type.enum';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { AccessTier } from '@/database/entities/access-tier.enum';
import { sanitizeTitle, sanitizeDescription } from './scenario-text-sanitizer';

export interface PersonalScenarioInput {
  id?: string;
  title: string;
  description?: string;
  ownerId: string;
  languageId: string;
  orderIndex?: number;
  accessTier?: AccessTier;
}

export function buildPersonalScenarioPartial(input: PersonalScenarioInput): Partial<Scenario> {
  const title = sanitizeTitle(input.title);
  const description = sanitizeDescription(input.description);
  return {
    ...(input.id ? { id: input.id } : {}),
    type: ScenarioType.PERSONAL,
    ownerId: input.ownerId,
    languageId: input.languageId,
    title,
    ...(description !== undefined ? { description } : {}),
    status: ContentStatus.PUBLISHED,
    triggersPersonalization: false,
    ...(input.orderIndex !== undefined ? { orderIndex: input.orderIndex } : {}),
    ...(input.accessTier !== undefined ? { accessTier: input.accessTier } : {}),
  };
}

export function isValidPersonalScenarioInput(input: PersonalScenarioInput): boolean {
  return sanitizeTitle(input.title).length > 0;
}
