---
phase: 5
title: "Tests + Docs"
status: done
priority: P2
effort: "4h"
dependencies: [4]
---

# Phase 5: Tests + Docs

## Overview
Add unit tests for helper + sanitizer + materialization service (with structured log assertions). Update auth service spec to cover the three signup call sites + race-loser + best-effort failure cases. E2E covers materialization + idempotency via NestJS DI direct call (no Firebase HTTP path — per CLAUDE.md "no mocks" rule it's better to bypass HTTP and call the service directly). Update docs.

Note: spec sweep for dropped `difficulty`/`icon`/`accentColor` references was moved to Phase 2 (Finding 10). This phase focuses on NEW tests + docs.

## Requirements
- Functional: full `npm test` + `npm run test:e2e` green.
- Non-functional: no skipped tests, no fake DB shortcuts that hide real query failures (per CLAUDE.md rule). Real Postgres test container for E2E.

## Architecture
- Unit tests: pure-function tests for helper/sanitizer; service-level tests with mocked `Repository<Scenario>` (via TypeORM `getRepositoryToken`).
- E2E test: Nest test module with real Postgres; call `AuthService.linkOnboardingSession` directly (not via HTTP) to bypass Firebase verification — documented as deliberate trade-off (Finding 15).

## Related Code Files
- Create: `src/modules/scenario/helpers/scenario-text-sanitizer.spec.ts`
- Create: `src/modules/scenario/helpers/personal-scenario-builder.spec.ts`
- Create: `src/modules/scenario/services/onboarding-materialization.service.spec.ts`
- Modify: `src/modules/auth/auth.service.spec.ts` — add materialization call assertions for all 3 signup paths.
- Create or modify (E2E): `test/onboarding-materialization.e2e-spec.ts` — direct-DI integration test.
- Modify: `docs/system-architecture.md` — add materialization step to onboarding→login flow.
- Modify: `docs/api-documentation.md` — drop `difficulty` from `/scenarios/*` examples; drop `level` query from `/lessons`; note `icon`/`accentColor` removal from `/onboarding/complete`.
- Modify: `docs/codebase-summary.md` — note new `ScenarioMaterializationModule` + helper location.
- Modify: `docs/project-changelog.md` — entry for the change, including the breaking API contract notes.

## Implementation Steps

### 5.1 — Sanitizer tests
`scenario-text-sanitizer.spec.ts`:
- Strips HTML: `'<script>alert(1)</script>Hello'` → `'Hello'`.
- Strips control chars: `'A\x00B\x07C'` → `'ABC'`.
- Trims whitespace.
- Caps at 255: `'a'.repeat(300)` → length 255.
- Preserves Unicode letters (Vietnamese diacritics, em-dash, emoji).
- `sanitizeDescription` returns `undefined` for non-string and empty result.

### 5.2 — Builder tests
`personal-scenario-builder.spec.ts`:
- With id → partial includes id.
- Without id → partial omits id.
- Defaults: `type=PERSONAL`, `status=PUBLISHED`, `triggersPersonalization=false`, `ownerId`/`languageId` from input.
- Without `orderIndex` → partial omits the field (DB default applies).
- Without `accessTier` → partial omits the field.
- Title with HTML/control chars → sanitized version in result.
- Oversized title → capped at 255.
- `isValidPersonalScenarioInput` returns false when title sanitizes to empty.

### 5.3 — Materialization service tests
`onboarding-materialization.service.spec.ts` with mocked `Repository<Scenario>` (mock `createQueryBuilder` chain or replace whole repo).
- Happy path: 5 valid items + non-null languageId → `insert.values(...).orIgnore().execute()` called once with 5 partials; log event `success`.
- `scenarios = null` → no DB call; log event `skip.empty_json`.
- `scenarios = []` or length≠5 → no DB call; log event `skip.bad_shape`.
- `conversation.languageId = null` → no DB call; log event `skip.no_language_id`.
- All titles invalid (empty after sanitization) → no DB call; log event `skip.all_titles_invalid`.
- Tolerates old-shape JSON (with extra `icon`/`accentColor`/`difficulty` keys) — picks only id/title/description.
- Builds partial with `orderIndex = arrayIndex` (0..4).
- Repository throws → caught, no rethrow, log event `fail.db`.
- Asserts log payload contains `event:` discriminator on every call (use jest spy on `Logger.prototype.warn`/`log`).

### 5.4 — Auth service spec update
- Mock `OnboardingMaterializationService.materializeFromConversation`.
- For each of the 3 signup paths (signup, login, oauthLogin per `auth.service.ts:82,104,195`):
  - Materialization called once after successful link.
  - Materialization NOT called when `affected === 0` (race loser).
  - When materialization rejects (simulate thrown promise) → linkOnboardingSession does NOT throw (defense-in-depth — service is self-guarded but test the outer caller path).
- Verify materialization called with `(userId, conversation)` matching the linked conversation.

### 5.5 — E2E test (NestJS DI direct call)
Rationale per CLAUDE.md "no mocks/fakes" rule: rather than mocking Firebase to drive HTTP `/auth/firebase`, build a Nest test module with the real `AuthService` and Postgres, then call `linkOnboardingSession` directly (or the public `signup` if Firebase verification can be swapped at module level — see existing test pattern).

`onboarding-materialization.e2e-spec.ts`:
- Setup: Nest test module + real Postgres (use existing test DB harness).
- Seed: create user row; create anonymous `AiConversation` with valid `languageId` + 5-item `scenarios` JSON.
- Act: invoke `authService['linkOnboardingSession'](userId, conversation.id)` (cast through type to access private if needed) OR via a test-only `AuthService.testLinkOnboarding` if compatibility broken.
- Assert: `SELECT id, title, owner_id FROM scenarios WHERE owner_id = ? AND type='personal'` returns 5 rows with sanitized titles.
- Repeat invocation → still 5 rows (PK conflict → DO NOTHING).
- Run with scenarios JSON length=4 → 0 rows materialized (validates skip path); structured log assertion via test logger.

If the project doesn't have a real Postgres harness already, document the constraint and fall back to integration test within unit-spec framework using TypeORM `sqlite::memory:` — and explicitly note in the test file comment that prod uses Postgres-specific `ON CONFLICT` semantics (sqlite handles `INSERT OR IGNORE` similarly via TypeORM `orIgnore`).

### 5.6 — Docs
- `docs/system-architecture.md` — in onboarding/auth flow section, add a paragraph + a mermaid step describing materialization on link, including the structured log event names for ops grep.
- `docs/api-documentation.md`:
  - Update `/scenarios/personal`, `/scenarios/default`, `/scenarios/:id`, `/scenarios/redeem` JSON examples to remove `difficulty`.
  - Update `/lessons` docs: remove `level` query param; remove `difficulty` from response example.
  - Update `/onboarding/complete` docs: remove `icon`/`accentColor` from response example.
- `docs/codebase-summary.md`: add entry under modules — `ScenarioMaterializationModule` and `scenario/helpers/` directory.
- `docs/project-changelog.md`: add entry:
  ```
  ### 2026-05-13 — Onboarding → Personal Scenarios Materialization
  - feat(scenarios): materialize anonymous-onboarding scenarios into PERSONAL rows on first auth-link
  - BREAKING(api): /scenarios/* responses no longer include `difficulty`
  - BREAKING(api): /lessons response no longer includes `difficulty`; `level` query param removed
  - BREAKING(api): /onboarding/complete response no longer includes `icon` and `accentColor`
  - chore(db): dropped `scenarios.difficulty` column + `scenario_difficulty` enum type + `idx_scenarios_difficulty` index
  - chore(prompts): removed "Align difficulty with suggestedProficiency" from onboarding + personalize prompts
  - security: sanitize scenario titles (strip HTML/control chars, 255-char cap) before persistence
  - observability: structured log events for materialization outcomes (event: onboarding.materialization.*)
  ```

### 5.7 — Final verification
1. `npm run lint`.
2. `npm test` (full Jest, no `--testPathPattern`).
3. `npm run test:e2e`.
4. `npm run build` final.

## Success Criteria
- [ ] All new unit specs exist with ≥4 cases each.
- [ ] Materialization service spec asserts log `event:` on every code path.
- [ ] Auth service spec covers all 3 signup call sites + race-loser + best-effort failure.
- [ ] E2E proves materialization + idempotency end-to-end via real or real-equivalent DB.
- [ ] All 4 docs files updated.
- [ ] `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build` all green.

## Risk Assessment
- **Risk:** E2E test bypasses HTTP layer → misses interactions in interceptors/guards. **Mitigation:** acceptable — auth pipeline coverage exists in other e2e specs; this test focuses on materialization correctness.
- **Risk:** Real Postgres test harness not present. **Mitigation:** documented fallback to in-memory DB acknowledging Postgres-specific semantics drift; flag in test comment.
- **Risk:** Mock `Logger` interferes with NestJS internals. **Mitigation:** use jest `spyOn(Logger.prototype, 'warn')` scoped to test file only.

## Next Steps (out of scope)
- Mobile (Flutter) PR to remove `difficulty`, `icon`, `accentColor`, and `level` query references.
- Direct-signin UX for users who skip onboarding (separate plan).
- Backfill plan for pre-cache AUTHENTICATED conversations with empty `scenarios` JSON (separate plan).
- Decide whether to add `(owner_id, type, title)` defensive uniqueness on `scenarios` for additional safety.
