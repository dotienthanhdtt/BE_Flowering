# Phase 2 — Schema Migrations & Entity Updates

**Priority:** P0 · **Effort:** 4h · **Status:** complete · **Depends on:** Phase 1 + Pre-Migration Data Audit

## Context

- Brainstorm §Schema Changes (Revised). [brainstorm](../reports/brainstorm-260418-2114-multi-language-content-architecture.md)
- Existing migrations directory: `src/database/migrations/`
- Latest timestamp: `1776100000000-add-onboarding-cache-to-ai-conversations.ts`
- New timestamps: `1777000000000` onward (monotonic increment of 100_000 per migration)

## Goal

Add `language_id` FK to `exercises`, `user_progress`, `user_exercise_attempts`. Make `scenarios.language_id` and `ai_conversations.language_id` NOT NULL (backfill first). Register new entity fields. All migrations **idempotent** (safe to rerun in staging).

## Key Insights

- `Lesson.languageId` already NOT NULL — backfill source for Exercise/UserProgress.
- `UserExerciseAttempt` → backfill via `exercise.lesson_id → lesson.language_id`.
- Backfill order matters: Exercise first, then UserExerciseAttempt (depends on Exercise).
- Scenario `language_id IS NULL` historically meant "global" — now must be backfilled to a specific language (default `en` per brainstorm decision) or archived.
- AiConversation `language_id IS NULL` present on legacy anonymous onboarding rows — backfill to `en` or derive from `metadata.targetLanguage` if present.

## Data Audit (fill in before running)

Run queries from `plan.md` §Pre-Migration Data Audit. Record counts here:

| Query | Count | Notes |
|---|---|---|
| `lessons WHERE language_id IS NULL` | _TBD_ | Expect 0; blocker if >0 |
| `scenarios WHERE language_id IS NULL` | _TBD_ | Backfill default `en` |
| `ai_conversations WHERE language_id IS NULL` | _TBD_ | Prefer `metadata->>'targetLanguage'` → fallback `en` |
| `exercises` orphans (no lesson) | _TBD_ | Must be 0 — delete orphans if any |
| `user_progress` orphans | _TBD_ | Must be 0 |
| `user_exercise_attempts` orphans | _TBD_ | Must be 0 |

## Requirements

### Functional
- FR1: `exercises.language_id` NOT NULL FK → `languages(id)` + index
- FR2: `user_progress.language_id` NOT NULL FK → `languages(id)` + index + composite index `(user_id, language_id, status)`
- FR3: `user_exercise_attempts.language_id` NOT NULL FK → `languages(id)` + index
- FR4: `scenarios.language_id` NOT NULL (drop nullable)
- FR5: `ai_conversations.language_id` NOT NULL (drop nullable)
- FR6: Every entity file reflects new column (`@Column({ type: 'uuid', name: 'language_id' })`, non-optional where applicable)

### Non-Functional
- Migration runs in <30s on production data volume
- Down migrations provided (re-add nullability, drop FK/index, drop column where added)

## Related Code Files

### Create (migrations)
- `src/database/migrations/1777000000000-add-language-id-to-exercises.ts`
- `src/database/migrations/1777000100000-add-language-id-to-user-progress.ts`
- `src/database/migrations/1777000200000-add-language-id-to-user-exercise-attempts.ts`
- `src/database/migrations/1777000300000-backfill-and-enforce-scenario-language-id.ts`
- `src/database/migrations/1777000400000-backfill-and-enforce-ai-conversation-language-id.ts`

### Modify (entities)
- `src/database/entities/exercise.entity.ts` — add `languageId: string` + relation
- `src/database/entities/user-progress.entity.ts` — add `languageId: string` + relation + update `@Unique`
- `src/database/entities/user-exercise-attempt.entity.ts` — add `languageId: string` + relation
- `src/database/entities/scenario.entity.ts` — drop `?` from `languageId`, drop nullable from `@ManyToOne`/`@Column`
- `src/database/entities/ai-conversation.entity.ts` — drop `?` + nullable from language fields

### No changes needed
- `src/database/database.module.ts` — entity list already registered
- `src/database/entities/lesson.entity.ts` — already required

## Implementation Steps

### Migration 1 — Exercise
```ts
// 1777000000000-add-language-id-to-exercises.ts
public async up(q: QueryRunner) {
  await q.query(`ALTER TABLE exercises ADD COLUMN language_id uuid`);
  await q.query(`
    UPDATE exercises e
    SET language_id = l.language_id
    FROM lessons l WHERE l.id = e.lesson_id
  `);
  await q.query(`ALTER TABLE exercises ALTER COLUMN language_id SET NOT NULL`);
  await q.query(`ALTER TABLE exercises ADD CONSTRAINT fk_exercises_language
    FOREIGN KEY (language_id) REFERENCES languages(id)`);
  await q.query(`CREATE INDEX idx_exercises_language ON exercises(language_id)`);
}
public async down(q: QueryRunner) {
  await q.query(`DROP INDEX IF EXISTS idx_exercises_language`);
  await q.query(`ALTER TABLE exercises DROP CONSTRAINT IF EXISTS fk_exercises_language`);
  await q.query(`ALTER TABLE exercises DROP COLUMN IF EXISTS language_id`);
}
```

### Migration 2 — UserProgress
Same pattern: add column, backfill from `lesson.language_id`, enforce NOT NULL, FK, index.
Composite index: `CREATE INDEX idx_user_progress_user_lang_status ON user_progress(user_id, language_id, status)`.

### Migration 3 — UserExerciseAttempt
Backfill:
```sql
UPDATE user_exercise_attempts uea
SET language_id = l.language_id
FROM exercises e
JOIN lessons l ON l.id = e.lesson_id
WHERE e.id = uea.exercise_id
```
Index: `(user_id, language_id, created_at DESC)` for attempt history queries.

### Migration 4 — Scenario (backfill + NOT NULL)
```ts
public async up(q: QueryRunner) {
  const defaultLang = await q.query(`SELECT id FROM languages WHERE code = 'en' LIMIT 1`);
  if (!defaultLang.length) throw new Error('Default language "en" missing — seed first');
  await q.query(`UPDATE scenarios SET language_id = $1 WHERE language_id IS NULL`, [defaultLang[0].id]);
  await q.query(`ALTER TABLE scenarios ALTER COLUMN language_id SET NOT NULL`);
}
public async down(q: QueryRunner) {
  await q.query(`ALTER TABLE scenarios ALTER COLUMN language_id DROP NOT NULL`);
}
```

### Migration 5 — AiConversation (backfill + NOT NULL)
```sql
-- Prefer metadata.targetLanguage → resolve to code → language_id
UPDATE ai_conversations ac
SET language_id = l.id
FROM languages l
WHERE ac.language_id IS NULL
  AND ac.metadata->>'targetLanguage' IS NOT NULL
  AND l.code = ac.metadata->>'targetLanguage';
-- Remaining NULLs → default 'en'
UPDATE ai_conversations SET language_id = (SELECT id FROM languages WHERE code='en') WHERE language_id IS NULL;
ALTER TABLE ai_conversations ALTER COLUMN language_id SET NOT NULL;
```

### Entity Updates
- `exercise.entity.ts`:
  ```ts
  @ManyToOne(() => Language) @JoinColumn({ name: 'language_id' }) language!: Language;
  @Column({ type: 'uuid', name: 'language_id' }) languageId!: string;
  ```
- `user-progress.entity.ts`:
  ```ts
  @ManyToOne(() => Language) @JoinColumn({ name: 'language_id' }) language!: Language;
  @Column({ type: 'uuid', name: 'language_id' }) languageId!: string;
  ```
  Update `@Unique(['userId', 'lessonId'])` — keep as is (lessonId implies languageId via FK; adding languageId to unique would allow duplicate progress records per language for same lesson, which cannot happen because a lesson belongs to one language).
- `user-exercise-attempt.entity.ts`: add `languageId`.
- `scenario.entity.ts`: change `languageId?: string` → `languageId!: string`; drop `nullable: true` on `@ManyToOne` and `@Column`.
- `ai-conversation.entity.ts`: change `languageId?: string | null` → `languageId!: string`; drop `nullable: true` on `@ManyToOne` + `@Column`.

## Todo

- [x] Run Pre-Migration Data Audit queries; fill counts
- [x] Confirm backfill-language default (`en`) with user
- [x] Write 5 migration files
- [x] Update 5 entity files
- [x] `npm run migration:run` on local/staging DB
- [x] Verify column counts post-migration (all `language_id IS NOT NULL`)
- [x] `npm run build` clean
- [x] `npm test` green (existing tests must not break; fix any fixtures that build Exercise/UserProgress without languageId)

## Success Criteria

- All 5 migrations run green on staging
- Post-migration `SELECT COUNT(*) FROM <table> WHERE language_id IS NULL` returns 0 for all 5 tables
- Entity TS definitions compile + match column nullability
- Seed/test fixtures updated to pass `languageId` where required (likely `test/fixtures/*.ts` if any)

## Risk Assessment

- **Backfill failure on large tables** — each migration runs in a transaction; with ~0 NULLs today, runtime should be sub-second. Monitor Railway logs during deploy.
- **Existing seed scripts** — may construct Exercise/UserProgress without languageId. Grep for entity usage in `src/database/seeds/` if any, and in test files.
- **Scenario backfill semantics** — backfilling ex-global scenarios to `en` means Spanish/French learners lose visibility of those scenarios. Acceptable because brainstorm confirms per-language-only strategy; content team must re-seed for other languages.
- **Railway deploy order** — migration 5 depends on `metadata.targetLanguage` existing on some rows; if JSONB query parse errors, fallback default covers it.

## Security Considerations

- No RLS policy change needed — existing user-scoped policies still apply; `language_id` is additive.
- Ensure FK constraint `ON DELETE` behavior: we choose no-action for `language_id` (deleting a language when content exists must fail loudly).

## Next Steps

Phase 3 — Service layer filtering uses the new `language_id` columns to partition queries.
