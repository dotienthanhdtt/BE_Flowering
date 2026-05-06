# Phase 6 — Tests, E2E Validation, Docs

**Priority:** P0 · **Effort:** 3h · **Status:** complete · **Depends on:** Phase 1–5

## Context

Phases 1-5 add code; this phase validates end-to-end behavior, updates documentation, and prepares the release checklist.

## Goal

Demonstrate provable isolation: a user with `en` active cannot see/write `es` data. All existing tests pass with new language context. Docs reflect new request contract + admin workflow.

## Requirements

### Functional
- FR1: E2E test — header switch triggers different data sets
- FR2: E2E test — progress saved under `en` is invisible under `es` header
- FR3: E2E test — anonymous onboarding without header → 400
- FR4: E2E test — admin can generate + publish; non-admin rejected
- FR5: Unit coverage ≥ 80% on new files (decorator, guard, admin service)

### Non-Functional
- CI green on `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e`
- Docs pages updated, cross-links correct

## Related Code Files

### Create (tests)
- `test/e2e/multi-language.e2e-spec.ts` — header isolation, progress scoping, onboarding, admin
- `src/common/guards/language-context.guard.spec.ts` (already in Phase 1; ensure coverage complete)
- `src/modules/admin-content/admin-content.service.spec.ts`

### Modify (tests)
- `src/modules/lesson/lesson.service.spec.ts` — add `languageId` param tests + draft exclusion
- `src/modules/scenario/services/scenario-chat.service.spec.ts` — language scoping
- `src/modules/onboarding/onboarding.service.spec.ts` — language resolution

### Docs
- `docs/codebase-summary.md` — new `admin-content` module + `common/guards/language-context.guard`
- `docs/system-architecture.md` — request flow diagram (JWT → LanguageContext → handler)
- `docs/api-documentation.md` — add `X-Learning-Language` header requirement, admin endpoints
- `docs/multi-language-architecture.md` (new) — architecture doc w/ decorator, fallback, seeding workflow
- `docs/project-changelog.md` — entry for migrations + request context change
- `docs/development-roadmap.md` — mark multi-language partitioning milestone complete

## Implementation Steps

### 1. E2E Test Suite
Create `test/e2e/multi-language.e2e-spec.ts`:
```ts
describe('Multi-language isolation', () => {
  let app: INestApplication;
  let enToken: string; let esToken: string;
  beforeAll(async () => { /* boot app, seed 2 users, 2 languages, 2 lessons */ });

  it('returns only en lessons under en header', async () => { … });
  it('returns only es lessons under es header', async () => { … });
  it('rejects wrong-language enrollment', async () => { /* user not enrolled in 'fr' → 403 */ });
  it('falls back to UserLanguage.isActive', async () => { … });
  it('anonymous onboarding requires header', async () => { … });
  it('progress saved under en invisible under es', async () => { … });
  it('admin can generate drafts; non-admin 403', async () => { … });
  it('drafts not visible on public endpoints', async () => { … });
});
```

### 2. Run & fix local test suites
`npm test -- --coverage` → identify gaps in new files. Target ≥ 80%.

### 3. Docs updates
- `docs/multi-language-architecture.md` — 400–600 lines covering: rationale, request flow ascii diagram, decorator/guard usage code samples, seeding workflow, failure modes, rollback strategy.
- `docs/api-documentation.md` — prepend section "Active Learning Language Header"; add `/admin/content/*` reference.
- `docs/project-changelog.md` — entry:
  ```md
  ## 2026-04-XX — Multi-language Content Partitioning
  - Added `X-Learning-Language` request header + `LanguageContextGuard`
  - Added `language_id` to `exercises`, `user_progress`, `user_exercise_attempts`
  - Made `language_id` NOT NULL on `scenarios`, `ai_conversations`
  - Added `status` enum to content tables (draft/published/archived)
  - Added `/admin/content/*` endpoints with `AdminGuard`
  - Added `User.isAdmin` + `ADMIN_EMAILS` env bootstrap
  ```

### 4. Release checklist
Document in `plan.md` at plan completion:
- [ ] Audit queries run against prod read-replica
- [ ] Staging deployed with all 7 migrations
- [ ] Staging E2E tests pass
- [ ] Mobile client has header implementation ready
- [ ] Admin email list seeded via env
- [ ] Feature-flag (if any) set; otherwise simultaneous backend + mobile release
- [ ] Rollback plan: migrations have `down()`; mobile old build works via UserLanguage.isActive fallback for 1 version

## Todo

- [x] Build E2E spec with 8 cases above
- [x] Update 3 service specs for language scoping
- [x] Run `npm test -- --coverage`; meet 80% on new files
- [x] Write `docs/multi-language-architecture.md`
- [x] Update `docs/api-documentation.md` with header + admin endpoints
- [x] Update `docs/codebase-summary.md` with new module
- [x] Update `docs/system-architecture.md` diagram
- [x] Append to `docs/project-changelog.md`
- [x] Update `docs/development-roadmap.md`
- [x] Final `npm run lint && npm run build && npm test && npm run test:e2e` green

## Success Criteria

- All 8 E2E cases pass
- Coverage report shows new files ≥ 80%
- 5 docs files updated; new architecture doc present
- No lint/build/test errors

## Risk Assessment

- **E2E flakiness** — ensure DB reset between specs (use transactions or `beforeEach` truncate); avoid relying on seed order
- **Docs drift** — consolidate updates in one PR; diff reviewed by code-reviewer agent
- **Roadmap entry** — low-risk, routine maintenance

## Security Considerations

- Re-run security review (OWASP top 10) focus on IDOR across languages — E2E FR3/FR6 cover this
- Verify admin endpoints NOT exposed via public Swagger in production

## Next Steps

After Phase 6 green:
1. Open PR to `dev`
2. Deploy staging, run audit queries, monitor logs for fallback-warning volume
3. Merge + deploy to production; coordinate mobile release
