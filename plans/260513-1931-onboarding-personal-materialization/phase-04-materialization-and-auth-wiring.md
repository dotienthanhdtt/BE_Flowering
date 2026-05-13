---
phase: 4
title: "Materialization + Auth Wiring"
status: done
priority: P1
effort: "4h"
dependencies: [3]
---

# Phase 4: Materialization + Auth Wiring

## Overview
Create `OnboardingMaterializationService` in scenario module. Wire it into `auth.service.linkOnboardingSession` so after atomic conversation-link success, JSON scenarios are inserted as PERSONAL rows via `INSERT ... ON CONFLICT (id) DO NOTHING` (no upsert — defends against cross-user PK collision and SYSTEM/KOL overwrite per Finding 3). Emit structured log events for every outcome (Finding 7). Validate `conversation.languageId` and title length before insert (Findings 8 + 9 + 14).

## Requirements
- Functional:
  - On atomic link success (`affected > 0`), valid scenarios inserted as PERSONAL rows for the linked user.
  - On PK collision → DB-level `DO NOTHING` skips silently (no overwrite of any pre-existing row).
  - Pre-checks (with structured warn logs on skip): null/missing `scenarios` JSON, length≠5, null `languageId`, sanitized title becomes empty.
  - Best-effort: all failures logged, never throw.
- Non-functional:
  - Uses thin `ScenarioMaterializationModule` (NOT full `ScenariosModule`) to avoid pulling `ScenariosController` + throttler config into AuthModule (Finding 11).
  - All log events use discrete `event:` field for grep-counting in Railway logs.

## Architecture
```
AuthModule
  └── imports ScenarioMaterializationModule
       ├── TypeOrmModule.forFeature([Scenario])
       └── provides + exports OnboardingMaterializationService
            └── uses buildPersonalScenarioPartial + sanitizeTitle (Phase 3 helpers)

auth.service.ts:linkOnboardingSession
  ├── (existing) atomic update ANON → AUTHENTICATED  [race-guard]
  ├── (existing) bootstrapUserLanguage              [try/catch]
  ├── (NEW)     materializeOnboardingScenarios      [try/catch — service self-guards too]
  └── (existing) bootstrap nativeLanguage           [try/catch]
```

Three signup call sites of `linkOnboardingSession` (`auth.service.ts:82-83, 104-105, 195-196`) all benefit automatically — no per-site changes needed.

## Related Code Files
- Create: `src/modules/scenario/scenario-materialization.module.ts` — thin NestJS module.
- Create: `src/modules/scenario/services/onboarding-materialization.service.ts`
- Modify: `src/modules/auth/auth.module.ts` — import `ScenarioMaterializationModule`.
- Modify: `src/modules/auth/auth.service.ts` — inject service + call after `bootstrapUserLanguage` block (around line 386).
- Modify: `src/database/database.module.ts` — verify `Scenario` is in the global entities array (per CLAUDE.md Railway rule).

## Implementation Steps

### 4.1 — Service implementation
Create `onboarding-materialization.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Scenario } from '@/database/entities/scenario.entity';
import { AiConversation } from '@/database/entities/ai-conversation.entity';
import {
  buildPersonalScenarioPartial,
  isValidPersonalScenarioInput,
} from '../helpers/personal-scenario-builder';

interface RawScenarioJson {
  id?: string;
  title?: string;
  description?: string;
}

const EVENT = {
  SUCCESS: 'onboarding.materialization.success',
  SKIP_EMPTY: 'onboarding.materialization.skip.empty_json',
  SKIP_SHAPE: 'onboarding.materialization.skip.bad_shape',
  SKIP_LANG: 'onboarding.materialization.skip.no_language_id',
  SKIP_ALL_INVALID: 'onboarding.materialization.skip.all_titles_invalid',
  FAIL_DB: 'onboarding.materialization.fail.db',
} as const;

@Injectable()
export class OnboardingMaterializationService {
  private readonly logger = new Logger(OnboardingMaterializationService.name);

  constructor(
    @InjectRepository(Scenario) private readonly scenarioRepo: Repository<Scenario>,
  ) {}

  async materializeFromConversation(
    userId: string,
    conversation: AiConversation,
  ): Promise<void> {
    try {
      const raw = conversation.scenarios as unknown;

      if (raw === null || raw === undefined) {
        this.logger.warn({ event: EVENT.SKIP_EMPTY, userId, conversationId: conversation.id });
        return;
      }
      if (!Array.isArray(raw) || raw.length !== 5) {
        this.logger.warn({ event: EVENT.SKIP_SHAPE, userId, conversationId: conversation.id, length: Array.isArray(raw) ? raw.length : null });
        return;
      }
      if (!conversation.languageId) {
        this.logger.warn({ event: EVENT.SKIP_LANG, userId, conversationId: conversation.id });
        return;
      }

      const partials = (raw as RawScenarioJson[])
        .map((s, index) => ({
          input: {
            id: s?.id,
            title: typeof s?.title === 'string' ? s.title : '',
            description: typeof s?.description === 'string' ? s.description : undefined,
            ownerId: userId,
            languageId: conversation.languageId,
            orderIndex: index,
          },
        }))
        .filter(({ input }) => isValidPersonalScenarioInput(input))
        .map(({ input }) => buildPersonalScenarioPartial(input));

      if (partials.length === 0) {
        this.logger.warn({ event: EVENT.SKIP_ALL_INVALID, userId, conversationId: conversation.id });
        return;
      }

      // INSERT ... ON CONFLICT (id) DO NOTHING — never overwrite existing rows (cross-user safety).
      await this.scenarioRepo
        .createQueryBuilder()
        .insert()
        .into(Scenario)
        .values(partials)
        .orIgnore() // emits ON CONFLICT DO NOTHING on Postgres
        .execute();

      this.logger.log({
        event: EVENT.SUCCESS,
        userId,
        conversationId: conversation.id,
        count: partials.length,
      });
    } catch (error) {
      this.logger.warn({
        event: EVENT.FAIL_DB,
        userId,
        conversationId: conversation.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
```

Key safety notes embedded in code:
- `orIgnore()` → `ON CONFLICT DO NOTHING` (Postgres). Cross-user PK collision = skip, not overwrite. Addresses Finding 3.
- `isValidPersonalScenarioInput` filters items whose sanitized title is empty (Finding 9 follow-through).
- `event:` field on every log line allows grep-based counting in Railway (Finding 7).
- `languageId` pre-check ensures the entire batch doesn't fail on a single FK violation (Finding 8 / Phase 4 risk #3).

### 4.2 — Thin module
Create `scenario-materialization.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Scenario } from '@/database/entities/scenario.entity';
import { OnboardingMaterializationService } from './services/onboarding-materialization.service';

@Module({
  imports: [TypeOrmModule.forFeature([Scenario])],
  providers: [OnboardingMaterializationService],
  exports: [OnboardingMaterializationService],
})
export class ScenarioMaterializationModule {}
```
No controller, no throttler. AuthModule pulls only this.

### 4.3 — Verify global entity registration
- Read `src/database/database.module.ts` and confirm `Scenario` is in the global entities array. Per CLAUDE.md Railway rule, missing global registration causes runtime `EntityMetadataNotFoundError`. Add if missing.

### 4.4 — Wire AuthModule
- In `src/modules/auth/auth.module.ts`: add `ScenarioMaterializationModule` to `imports`. Verify no cycle (`ScenarioMaterializationModule` only depends on `TypeOrmModule` — no auth dependency, so no cycle).

### 4.5 — Inject + call from `linkOnboardingSession`
Modify `auth.service.ts`:
1. Constructor: add `private readonly onboardingMaterialization: OnboardingMaterializationService`.
2. After the `bootstrapUserLanguage` try-catch (around line 386, after the closing `}` of that block, BEFORE the nativeLanguage block), insert:
   ```ts
   await this.onboardingMaterialization.materializeFromConversation(userId, conversation);
   ```
   No outer try-catch needed — service is fully self-guarded.
3. Confirm placement is downstream of the `affected === 0` early return (line 364-369). All paths to materialization require `affected > 0`.

### 4.6 — Build + smoke
1. `npm run build`.
2. `npm run start:dev`.
3. Manual sanity (optional, if local DB primed):
   - Seed an `ai_conversations` row with type ANONYMOUS + scenarios JSON of 5 items.
   - `POST /auth/firebase` with `conversationId` referencing it.
   - `psql`: `SELECT id, title, owner_id FROM scenarios WHERE owner_id='<user>' AND type='personal'` → 5 rows.
   - Hit auth again same conversationId → 5 rows (no dup, no error).

## Success Criteria
- [ ] `ScenarioMaterializationModule` exists; exports `OnboardingMaterializationService`.
- [ ] Service uses `orIgnore()` (NOT `upsert`).
- [ ] Service emits one of 6 structured log events per call.
- [ ] Service has explicit `languageId` pre-check with `SKIP_LANG` log.
- [ ] Service filters items by `isValidPersonalScenarioInput` (sanitized title non-empty).
- [ ] AuthModule imports the thin module (verify by reading auth.module.ts).
- [ ] `auth.service.ts:linkOnboardingSession` calls materialization AFTER bootstrapUserLanguage, BEFORE nativeLanguage update.
- [ ] `Scenario` entity registered in `database.module.ts` global entities array.
- [ ] App boots without DI errors.
- [ ] Manual smoke: 5 PERSONAL rows after first sign-in; re-sign-in → still 5.

## Risk Assessment
- **Risk:** `orIgnore()` not supported on the database driver in use. **Mitigation:** Postgres only target; `orIgnore` generates `ON CONFLICT DO NOTHING` which is standard since PG 9.5.
- **Risk:** Bulk insert fails if ONE row violates a constraint (e.g., FK). **Mitigation:** `ON CONFLICT DO NOTHING` only handles PK conflicts; FK violations still abort the batch. Mitigated by `languageId` pre-check; remaining risk is acceptable.
- **Risk:** TypeORM `createQueryBuilder().insert().orIgnore()` rejects `Partial<Scenario>[]` typing. **Mitigation:** verified pattern; values can be `QueryDeepPartialEntity<Scenario>[]`. Use type cast `as QueryDeepPartialEntity<Scenario>[]` if compiler complains.
- **Risk:** Module cycle via transitive imports. **Mitigation:** thin module has NO imports of any auth/user code → no cycle possible.
- **Risk:** Race: same user calls /auth twice in parallel with same conversationId → both pass atomic-update check? **Mitigation:** NO — atomic update is single-row UPDATE with WHERE type=ANONYMOUS; one of them flips type to AUTHENTICATED, the other's WHERE clause no longer matches, `affected=0`, early return. Materialization runs exactly once per successful link.
- **Risk:** Pre-cache conversations (`scenarios = null`) silently skip. **Mitigation:** `SKIP_EMPTY` log event surfaces this. Fallback regeneration deferred to follow-up plan (out of scope).

## Security Considerations
- Title/description sanitization done in helper (Phase 3); service trusts helper output. Anonymous onboarding chat can no longer inject HTML/control chars into the scenarios table.
- `INSERT ... ON CONFLICT DO NOTHING` means no path can overwrite another user's scenarios via PK collision. Even if an attacker knew another user's scenario UUIDs, the insert is rejected at DB level.
- Best-effort failure mode prevents materialization issues from gating login (no DoS surface on auth).
