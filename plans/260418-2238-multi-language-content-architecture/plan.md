---
title: "Multi-Language Content Architecture"
description: "Partition lessons/exercises/scenarios/progress/AI per learning language. Request context via X-Learning-Language header + DB fallback. Admin seeding module."
status: complete
priority: P0
effort: 20h
branch: dev
tags: [architecture, multi-language, migrations, nestjs, admin]
created: 2026-04-18
brainstorm: plans/reports/brainstorm-260418-2114-multi-language-content-architecture.md
blockedBy: []
blocks: []
---

# Multi-Language Content Architecture

## Summary

Partition all learning content (lessons, exercises, scenarios) and user learning state (progress, exercise attempts, AI conversations) by target learning language. Mobile sends `X-Learning-Language: <code>` header per request; a `LanguageContextGuard` resolves code → UUID (fallback to `UserLanguage.isActive`); services filter by `languageId`. Adds admin content seeding endpoints for hybrid AI draft + human review workflow.

Based on: [brainstorm report](../reports/brainstorm-260418-2114-multi-language-content-architecture.md)

## Architecture Decisions (from brainstorm, confirmed against codebase)

- **Partitioned content** (Option A) — each row owns one `languageId`. Rejected translations-table (Option B). Language lessons ≠ i18n.
- **Scenarios: per-language only** — migrate `languageId` nullable → NOT NULL. No globals.
- **Exercise.languageId denormalized** — add column, backfill from `lesson.language_id`, make NOT NULL. Avoids O(N) JOIN on hot path.
- **UserProgress / UserExerciseAttempt: required `languageId`** — hard progress isolation per active language.
- **AiConversation.languageId: NOT NULL** — every conversation owns a language (incl. anonymous onboarding).
- **Request context via header + decorator + guard**, not middleware. Resolves `code` → `{id, code}` once per request; DB fallback when header absent.
- **Admin seeding: minimal** — generate drafts (LLM) + publish endpoint. Auth guard reuses existing JWT + env-controlled admin role flag (no full RBAC system).

## Phases

| # | Phase | Status | Effort | File |
|---|-------|--------|--------|------|
| 1 | Request context infrastructure (decorator + guard) | complete | 2h | [phase-01](phase-01-request-context-infrastructure.md) |
| 2 | Schema migrations + entity updates | complete | 4h | [phase-02](phase-02-schema-migrations-and-entities.md) |
| 3 | Service layer filtering | complete | 4h | [phase-03](phase-03-service-layer-filtering.md) |
| 4 | Controllers + AI chat integration | complete | 3h | [phase-04](phase-04-controllers-and-ai-chat.md) |
| 5 | Admin content seeding module | complete | 4h | [phase-05-admin-content-seeding.md](phase-05-admin-content-seeding.md) |
| 6 | Tests, validation, docs | complete | 3h | [phase-06](phase-06-tests-and-docs.md) |

## Key Dependencies

- Entities: `Lesson`, `Exercise`, `UserProgress`, `UserExerciseAttempt`, `Scenario`, `AiConversation`, `UserLanguage`, `Language`
- Services: `LessonService`, `LearningAgentService`, `ScenarioChatService`, `TranslationService`, `OnboardingService`
- Migration timestamp base: `1777000000000` (latest existing: `1776100000000`)
- Existing decorators pattern: `@CurrentUser`, `@Public`, `@OptionalAuth`, `@RequirePremium`

## Pre-Migration Data Audit (MUST complete before Phase 2)

Run these queries via Supabase SQL editor or psql — document counts in `phase-02-schema-migrations-and-entities.md` under "Data Audit":

```sql
-- NULL language counts
SELECT COUNT(*) FROM scenarios WHERE language_id IS NULL;
SELECT COUNT(*) FROM ai_conversations WHERE language_id IS NULL;
-- All lessons have languageId (NOT NULL already) — verify:
SELECT COUNT(*) FROM lessons WHERE language_id IS NULL; -- expect 0
-- Exercise/UserProgress/UserExerciseAttempt backfill source via lesson
SELECT COUNT(*) FROM exercises e LEFT JOIN lessons l ON l.id = e.lesson_id WHERE l.id IS NULL; -- orphans
SELECT COUNT(*) FROM user_progress up LEFT JOIN lessons l ON l.id = up.lesson_id WHERE l.id IS NULL;
SELECT COUNT(*) FROM user_exercise_attempts uea LEFT JOIN exercises ex ON ex.id = uea.exercise_id WHERE ex.id IS NULL;
```

Decision inputs required before migrating:
- Default backfill language for legacy NULL rows (user answer required — default `en` proposed)
- Whether to delete vs backfill orphan/legacy scenarios with `language_id IS NULL`

## Unresolved Questions (escalate before Phase 2)

1. **Default backfill language** for NULL rows in `scenarios.language_id` and `ai_conversations.language_id` → proposed default `en`. Needs user confirmation.
2. **Anonymous onboarding + NOT NULL `AiConversation.languageId`**: `OnboardingService.startSession` currently stores `targetLanguage` as string in `metadata`. Must additionally resolve to `Language.id` and persist on `languageId` column. Covered in Phase 4.
3. **Admin authorization model**: no `isAdmin` / role system exists. Proposed: add `User.isAdmin` boolean + `AdminGuard` reading that flag; seeded via env (`ADMIN_EMAILS` comma list applied on first login). User must confirm before Phase 5.
4. **Header name & format**: confirm `X-Learning-Language: <code>` (e.g. `en`, `es`) — matches existing `Vocabulary.sourceLang/targetLang` and onboarding `targetLanguage` convention. Language UUIDs remain internal.

## Success Criteria

- [x] All learning content queries scoped by `languageId` via `@ActiveLanguage()` decorator
- [x] Zero cross-language data leakage in `UserProgress`, `UserExerciseAttempt`, `AiConversation`
- [x] Request w/o header → fallback resolves `UserLanguage.isActive`, logs warning
- [x] Existing anonymous onboarding & authenticated AI chat flows unchanged from API contract
- [x] Admin can generate draft lesson/exercise content via `POST /admin/content/generate`
- [x] Existing integration tests pass; new unit tests cover decorator, guard, service filters (317 tests passing)
- [x] `npm run build` clean, `npm test` green

## Risk Assessment

- **Migration order** — 5 sequential migrations touching hot tables; each ships nullable → backfill → NOT NULL. Run in staging first.
- **Backfill correctness** — UserProgress/UserExerciseAttempt backfill depends on valid lesson.language_id (already required). Low risk.
- **Anonymous flow breakage** — missing languageId on anonymous AiConversation during migration window. Backfill default `en` first.
- **Mobile regression** — header-less requests during rollout. Mitigated by `UserLanguage.isActive` DB fallback + warning log.
- **Admin module scope creep** — keep Phase 5 minimal: 2 endpoints, draft/published states only.

## Docs Impact

- Update `docs/codebase-summary.md` — new request-scoped language context + admin-content module
- Update `docs/api-documentation.md` — header contract + admin endpoints
- Update `docs/system-architecture.md` — partitioning strategy diagram
- Add `docs/multi-language-architecture.md` (new) — decorator/guard usage, seeding workflow

## Next Steps

1. Run Pre-Migration Data Audit queries; record counts in Phase 2 doc.
2. Confirm 4 unresolved questions with user.
3. Execute phases sequentially; do not start Phase 3 until Phase 2 migrations pass on staging.
