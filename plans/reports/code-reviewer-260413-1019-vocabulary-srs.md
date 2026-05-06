# Code Review — Vocabulary Leitner SRS (commit 5124040)

## Verdict
**PASS_WITH_CONCERNS** — ship-safe; two non-blocking bugs worth fixing in a follow-up.

## Scope
- Entity + migration: `vocabulary.entity.ts`, `1775800000000-add-srs-columns-to-vocabulary.ts`
- Services: `leitner.ts`, `vocabulary-review.service.ts`, `vocabulary.service.ts`, `review-session-store.ts`
- Controllers: `vocabulary.controller.ts`, `vocabulary-review.controller.ts`
- DTOs: `review-start`, `review-rate`, `vocabulary-query`
- Module wiring: `vocabulary.module.ts`, `database.module.ts`, `app.module.ts`

## Critical (block merge)
None.

## Important (fix soon, not blocking)

1. **Leitner docstring lies about box 1 promotion interval** — `leitner.ts:5-13`
   - Docstring: `box 1 → 2: +3 days`. Actual: `LEITNER_INTERVALS_DAYS[2] = 3` — OK.
   - But docstring says `any → 1 on wrong: +1 day`, which matches code.
   - However docstring also says `box 1 → 2: +3 days` (NEW box interval) yet at `leitner.ts:17` entry `1: 1` is used on FIRST review of a freshly-inserted card (box=1, correct, promoted to box 2 with `LEITNER_INTERVALS_DAYS[2]=3`). Consistent. **Re-reading: no bug — entry `1: 1` is only reachable via the wrong branch override, which already hard-codes `1`. Entry `1: 1` is dead but harmless.** Accept as style nit.

2. **Migration assumes `vocabulary` table pre-exists with compatible shape** — `1775800000000-add-srs-columns-to-vocabulary.ts:7-18`
   - Entity defines `word`, `translation`, `sourceLang`, `targetLang`, `Unique` constraint, `createdAt`, etc. No earlier migration in this PR creates the base `vocabulary` table. Migration only ADDs SRS columns.
   - If a prior migration (pre-existing in `src/database/migrations/`) creates the base table with matching columns, fine. If not, runtime error on prod deploy.
   - **Action**: verify a prior migration creates `vocabulary` with the exact columns the entity expects (word, translation, source_lang, target_lang, part_of_speech, pronunciation, definition, examples, user_id FK, created_at, unique constraint). If missing, add a base-table migration BEFORE this one.

3. **Double-rate race via concurrent requests** — `vocabulary-review.service.ts:42-65`
   - Guard `session.ratings.has(dto.vocabId)` is checked, then `repo.save` and `ratings.set` run non-atomically. Two concurrent rate calls for same card can both pass the `has` check → double box promotion + double `reviewCount++`.
   - Single-pod in-memory store makes this narrow (must be exact-simultaneous requests from same client), but still racy.
   - **Fix**: set `session.ratings.set(dto.vocabId, dto.correct)` immediately after the `has` check (before DB call). If persistence fails, delete the entry. Or use optimistic locking (`@VersionColumn`) on Vocabulary.

4. **Box constraint mismatch vs entity default** — `vocabulary.entity.ts:50` uses `default: 1`; migration adds CHECK `box BETWEEN 1 AND 5`. OK.
   - But plan says "on incorrect → box=0 or 1". Code resets to box 1 (`MIN_BOX = 1`). CHECK constraint forbids box 0. Consistent with code; plan wording was ambiguous. **Accept**.

## Adversarial findings

- **Entity registration** (2026-03-08 incident): `Vocabulary` in `database.module.ts:37` AND `vocabulary.module.ts:16` `TypeOrmModule.forFeature`. **Accept — verified clean.**
- **Authorization** on all endpoints: every controller method reads `req.user.id` and every service query/save filters by `userId`. `VocabularyService.list/findOne/remove` all pass `userId` into WHERE. `VocabularyReviewService.rate` uses `{ id, userId }` in findOne. `ReviewSessionStore.get` checks `s.userId !== userId` → ForbiddenException. **Accept — cannot access other users' data.**
- **JWT guard**: no `@Public()` decorator anywhere in module; global guard (per CLAUDE.md) applies to both controllers. **Accept.**
- **Leitner math**: `applyLeitner(currentBox, correct)` → correct: `min(current+1, 5)` w/ interval from new box; incorrect: `MIN_BOX=1` w/ +1 day. Off-by-one check: box 5 correct → stays 5, +30d (cap). Box 1 correct → box 2, +3d. Spec-compliant. **Accept.**
- **Concurrency / double-submit**: see Important #3. **Reject — real bug, low severity.**
- **Migration reversibility**: `up` adds 5 cols with NOT NULL defaults (safe for existing rows) + CHECK + index. `down` drops index, constraint, columns. Idempotent guards (`IF EXISTS`) on down. **Accept.**
- **Response wrapper**: returns plain DTOs; global `ResponseTransformInterceptor` wraps them. **Accept.**
- **Input validation**: all DTOs use class-validator; bounds present (box 1–5, limit 1–100, page ≥1, languageCode length 2–10, UUID check). Missing: `search` has `MaxLength(100)` — safe. **Accept.**
- **Pagination**: `VocabularyQueryDto` enforces `Max(100)` on limit. **Accept.**
- **SQL injection**: all queries use parameterized builders. `ILIKE :s` with `%${q.search}%` is safe (value goes through parameter). **Accept.**
- **N+1**: list endpoint uses single `getManyAndCount`; review start uses single `getMany`; complete uses single raw aggregate. **Accept.**
- **In-memory session store**: OK per plan (MVP, single-pod). TTL sweep cleans up. `randomUUID` for session ID. **Accept.**
- **Unique constraint**: `(userId, word, sourceLang, targetLang)`. Does not include `partOfSpeech`, so two entries like "bank" (noun) vs "bank" (verb) cannot coexist. **Defer — product decision, not a bug.**
- **Missing CREATE endpoint**: controller has only GET/DELETE. Presumably vocabulary rows are inserted by AI module (translation service). Not in this commit's scope. **Defer.**
- **`examples` jsonb typed as `string[]`**: TypeORM jsonb accepts arrays; OK, but no validation on insert path here (not in scope). **Defer.**

## Verified clean
- Entity registered in both module locations.
- No raw exceptions thrown; BadRequest/NotFound/Forbidden all proper NestJS exceptions caught by `AllExceptionsFilter`.
- Migration `up`/`down` symmetric with IF EXISTS guards.
- Leitner transitions deterministic; `now` injectable for tests.
- Session ownership enforced in `ReviewSessionStore.get`.
- All DB queries user-scoped.
- Param UUIDs validated via `ParseUUIDPipe`.
- `correctCount` only bumps on correct; `reviewCount` always bumps.

## Unresolved questions

1. Does a prior migration create the base `vocabulary` table matching the entity shape? (Migration #2 above — verify.)
2. Is single-pod deployment guaranteed on Railway? If horizontally scaled, in-memory `ReviewSessionStore` will 404 sessions when routed to a different pod. Plan says MVP-OK; confirm ops is aware.
3. Unique constraint excludes `partOfSpeech` — intentional? (User cannot save "bank" twice as noun + verb.)
4. Should `rate` endpoint be idempotent across retries (network-level), or is "already rated" error the intended UX?
