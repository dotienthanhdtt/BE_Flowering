---
phase: 3
title: "Shared Helper (DRY) + Sanitization"
status: done
priority: P2
effort: "1.5h"
dependencies: [2]
---

# Phase 3: Shared Helper (DRY) + Sanitization

## Overview
Create a single pure helper `buildPersonalScenarioPartial` in the scenario module. Used by both `PersonalizationService` (replacing the inline mapping) and the new `OnboardingMaterializationService` (Phase 4). Helper enforces title sanitization and length caps (Finding 9). Helper omits `orderIndex`/`accessTier` when not provided so existing personalization behavior (DB defaults) is preserved (Finding 13).

## Requirements
- Functional:
  - Returns a `Partial<Scenario>` suitable for `Repository.insert` / `createQueryBuilder().insert().orIgnore()`.
  - When `orderIndex` not passed → omit the field entirely (DB default applies).
  - When `accessTier` not passed → omit entirely (DB default applies).
  - When `id` passed → include as PK (for idempotency).
  - Title sanitized: trim whitespace, strip control chars, strip HTML tags, hard-cap to 255 chars (UTF-8 byte-safe).
  - Description (optional) sanitized similarly but no length cap (column is TEXT).
- Non-functional: pure function, no DI, no I/O. Trivially unit-testable.

## Architecture
```
src/modules/scenario/helpers/
  ├── personal-scenario-builder.ts       (export buildPersonalScenarioPartial + types)
  └── scenario-text-sanitizer.ts         (export sanitizeTitle, sanitizeDescription)
```
Both pure. No NestJS provider. Imported directly by services that need them.

## Related Code Files
- Create: `src/modules/scenario/helpers/personal-scenario-builder.ts`
- Create: `src/modules/scenario/helpers/scenario-text-sanitizer.ts`
- Modify: `src/modules/personalization/services/personalization.service.ts` — replace inline scenario shape construction at lines ~244-252 with helper call. Remove now-unused enum imports.

## Implementation Steps

### 3.1 — Sanitizer
Create `scenario-text-sanitizer.ts`:
```ts
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;
const HTML_TAGS = /<[^>]*>/g;
const TITLE_MAX = 255;

export function sanitizeTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const stripped = raw.replace(HTML_TAGS, '').replace(CONTROL_CHARS, '').trim();
  // Safely cap at 255 chars; Postgres varchar(255) counts characters, not bytes
  return stripped.length > TITLE_MAX ? stripped.slice(0, TITLE_MAX) : stripped;
}

export function sanitizeDescription(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const stripped = raw.replace(HTML_TAGS, '').replace(CONTROL_CHARS, '').trim();
  return stripped.length > 0 ? stripped : undefined;
}
```

### 3.2 — Builder
Create `personal-scenario-builder.ts`:
```ts
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

export function buildPersonalScenarioPartial(
  input: PersonalScenarioInput,
): Partial<Scenario> {
  const title = sanitizeTitle(input.title);
  const description = sanitizeDescription(input.description);
  const partial: Partial<Scenario> = {
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
  return partial;
}

/** Helper: returns true when sanitized title is non-empty and within limit. */
export function isValidPersonalScenarioInput(input: PersonalScenarioInput): boolean {
  return sanitizeTitle(input.title).length > 0;
}
```

### 3.3 — Refactor personalization service
- Import helper. Replace lines 244-252 in `personalization.service.ts` so each parsed scenario goes through `buildPersonalScenarioPartial(...)` with `ownerId` and `languageId` from method args. Do NOT pass `id` (DB-generated). Do NOT pass `orderIndex` (preserve DB default).
- Drop unused enum imports (`ScenarioDifficulty` already removed in Phase 2; verify no orphans).

### 3.4 — Verify
- `npm run build` → green.
- `npm test -- personalization` (if spec exists) → green or update assertions to match helper output (Phase 5 owns full sweep).

## Success Criteria
- [ ] `personal-scenario-builder.ts` + `scenario-text-sanitizer.ts` exist with described exports.
- [ ] `personalization.service.ts` no longer has inline scenario shape construction; uses helper.
- [ ] Helper omits `orderIndex` and `accessTier` when not passed (verified by reading source).
- [ ] Title sanitization strips HTML, trims, control chars, caps at 255.
- [ ] `npm run build` passes.

## Risk Assessment
- **Risk:** sanitizer over-strips legitimate punctuation (Vietnamese diacritics, em-dashes). **Mitigation:** regexes target only HTML tags + ASCII control chars (`\x00-\x1F\x7F`); Unicode letters/marks preserved.
- **Risk:** existing PERSONAL rows from personalization had different field defaults; subtle behavior delta. **Mitigation:** helper preserves omission of `orderIndex`/`accessTier` exactly — verified by reading current `personalization.service.ts:244-252` (no orderIndex, no accessTier set today).
- **Risk:** helper's `description` omission when sanitized to empty string differs from current `personalization.service.ts` behavior (which always sets `description` even when empty). **Mitigation:** acceptable — empty description is semantically the same as null/undefined; verify in Phase 5 test.

## Security Considerations
- Sanitization defends against XSS payloads from LLM-steered onboarding chat (Finding 9). Title cap defends against varchar(255) DB rejection that would otherwise silent-fail the entire upsert.
