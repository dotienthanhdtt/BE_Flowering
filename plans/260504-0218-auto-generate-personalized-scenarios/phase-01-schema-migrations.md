# Phase 01 — Schema Migrations

## Context Links
- Brainstorm: `../reports/brainstorm-260504-auto-generate-personalized-scenarios.md` §5.1
- Blocker plan: `../260501-1146-centralize-scenarios/plan.md` (must merge first; ships `scenarios.type` enum + `ownerUserId`)

## Overview
- **Priority:** P1 (blocks all downstream phases)
- **Status:** pending
- **Description:** Add user-level personalization columns, scenario trigger flag, new enum values (AccessTier, AiConversationType, LangfuseFeature). Single TypeORM migration.

## Key Insights
- Centralize-scenarios already adds `scenarios.type` (`'system' | 'kol' | 'personal'`) and `ownerUserId`. Do not duplicate.
- `triggersPersonalization` is a NEW column on `scenarios`, defaults `false` — backward-safe.
- `AccessTier.PREMIUM_PLUS` is additive; existing `premium` rows untouched.
- Snapshot stored as `jsonb` for cheap key-set diff.

## Requirements
**Functional:**
- New user columns: `personalizedTrialUsedAt`, `lastPersonalizationAt`, `personalizationProfileSnapshot`.
- New scenario column: `triggersPersonalization` (bool, default false, indexed).
- Enum additions: `AccessTier.PREMIUM_PLUS`, `AiConversationType.PERSONALIZE_INTAKE`, `LangfuseFeature.{PERSONALIZATION_CHAT, PERSONALIZATION_EXTRACTION, PERSONALIZATION_SCENARIOS}`.

**Non-Functional:**
- Migration reversible (down() drops columns + reverts enum values where Postgres allows).
- Zero downtime: all additive, no data rewrites.

## Architecture
Single migration file. TypeORM `ALTER TABLE` for cols, native SQL for enum value addition (`ALTER TYPE ... ADD VALUE`).

## Related Code Files
**Modify:**
- `src/database/entities/user.entity.ts` — add 3 columns
- `src/database/entities/scenario.entity.ts` — add `triggersPersonalization`
- `src/database/entities/access-tier.enum.ts` — add `PREMIUM_PLUS`
- `src/database/entities/ai-conversation.entity.ts` (or wherever `AiConversationType` lives) — add `PERSONALIZE_INTAKE`
- `src/modules/ai/langfuse-feature.enum.ts` — add 3 values

**Create:**
- `src/database/migrations/{timestamp}-add-personalization-fields.ts`

**Delete:** none

## Implementation Steps
1. Verify centralize-scenarios migration is present (entity has `type`, `ownerUserId`).
2. Add `AccessTier.PREMIUM_PLUS = 'premium_plus'` to enum file.
3. Add `AiConversationType.PERSONALIZE_INTAKE = 'personalize_intake'`.
4. Add three `LangfuseFeature` values.
5. Add user entity fields (all nullable).
6. Add `scenario.triggersPersonalization` (bool, default false). Add index.
7. Generate migration: `npm run migration:generate -- src/database/migrations/AddPersonalizationFields`.
8. Hand-edit migration to use `ALTER TYPE ... ADD VALUE IF NOT EXISTS` for Postgres enum extensions (TypeORM may not handle this cleanly).
9. Run `npm run migration:run` against dev DB; verify with `psql \d users` and `\d scenarios`.
10. Run `npm run build` to confirm no TS errors.

## Todo List
- [ ] Update enums (AccessTier, AiConversationType, LangfuseFeature)
- [ ] Update User entity (3 columns)
- [ ] Update Scenario entity (1 column + index)
- [ ] Generate migration
- [ ] Patch enum-extend SQL by hand
- [ ] Run migration on dev DB
- [ ] `npm run build` clean

## Success Criteria
- Migration runs forward and reverts cleanly on dev.
- `\d users` shows 3 new columns; `\d scenarios` shows `triggers_personalization`.
- `psql -c "SELECT unnest(enum_range(NULL::access_tier_enum));"` includes `premium_plus`.
- No existing tests broken; `npm run build` passes.

## Risk Assessment
- **Postgres enum extension non-transactional in some versions** → split into separate migration if blocker; document.
- **Index bloat on `triggersPersonalization`** → partial index `WHERE triggers_personalization = true` if cardinality skewed.

## Security Considerations
- `personalizationProfileSnapshot` may contain PII (profession, interests). Treat as sensitive: never log; exclude from default user serialization (use `@Exclude()` in DTO).

## Next Steps
- Unblocks Phase 02 (refactor engine) and Phase 03 (module skeleton consumes new fields).
