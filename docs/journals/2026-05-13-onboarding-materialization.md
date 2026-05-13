# Onboarding Scenario Materialization: Anonymous → Personal Translation

**Date**: 2026-05-13 14:30
**Severity**: Medium
**Component**: Onboarding, Scenarios, Authentication
**Status**: Resolved

## What Happened

Implemented a 5-phase feature that bridges the gap between anonymous onboarding chat and authenticated user accounts. When a user first logs in after completing the onboarding flow, the system now automatically materializes the 5 scenarios they generated in the onboarding conversation into real PERSONAL Scenario rows in their database. This eliminates friction: users don't start from scratch, and content generated during onboarding becomes immediately actionable.

## The Brutal Truth

This implementation touched schema cleanup that's overdue (removing `difficulty` from scenarios), wired auth to trigger a side-effect (materialization), and added validation logic that needed to handle edge cases without exploding the auth flow. The real win: it works, it's safe, and it doesn't block authentication if something goes sideways. But we're now storing generated scenario JSON directly in conversation messages—if that JSON is malformed or missing, we silently skip materialization. That's intentional but fragile.

## Technical Details

### Migration: Dropping `difficulty`

Created `1780000000000-drop-scenarios-difficulty.ts`:
- Drops `difficulty` column from `scenarios` table
- Drops `idx_scenarios_difficulty` index
- Drops `scenario_difficulty` enum
- Two-step Railway deployment: ship code first (stops reading field), run migration second (removes column)

Root cause of complexity: `difficulty` was read by lesson DTOs, redeem DTOs, scenario responses, and admin services. Removing it required updates in 7 files.

### Shared Helpers (New Files)

**`scenario-text-sanitizer.ts`**
- `sanitizeTitle()`: Strips HTML (script/style blocks + tag content), control chars, trims, caps at 255 chars
- `sanitizeDescription()`: Same logic, returns `undefined` if empty
- Regex pattern: `/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<[^>]*>/g` catches nested content, not just tags
- XSS safety by design—stripping tag content prevents stored script injection

**`personal-scenario-builder.ts`**
- `buildPersonalScenarioPartial()`: Creates type-safe `Partial<Scenario>` with fixed values: `type: "PERSONAL"`, `status: "PUBLISHED"`, `triggersPersonalization: false`
- `isValidPersonalScenarioInput()`: Guards against blank titles after sanitization (at least 1 char)
- Throws `BadRequestException` on validation failure—lets caller decide whether to halt or skip

### OnboardingMaterializationService

New `scenario-materialization.module.ts` housing core logic:

```typescript
async materializeFromConversation(userId: string, conversationId: string): Promise<void>
```

Flow:
1. Fetch `AiConversation` + messages containing `RawScenarioJson` array
2. Validate shape: null check, exactly 5 items, `languageId` present, at least 1 valid title
3. Map each to `Partial<Scenario>` via `buildPersonalScenarioPartial`
4. Bulk insert with `INSERT ... ON CONFLICT DO NOTHING` (idempotent—safe to retry)
5. Emit structured events: `onboarding.materialization.success` (count), `.skip.no_conversation`, `.skip.no_scenarios`, `.fail.db`

**Never rethrows**—all failures logged as structured events. Auth flow never blocked.

### Auth Wiring

Modified `auth.service.ts`:
- `linkOnboardingSession()` calls `materializeFromConversation()` after bootstrapping user language
- Wrapped in try-catch (best-effort side-effect)
- If materialization fails, user auth succeeds anyway—scenarios just won't appear

## What We Tried

1. **Full ScenariosModule in AuthModule**: Rejected—pulled in controller, route guards, throttler middleware. Too much surface area.
2. **Sync materialization blocking auth**: Rejected—if DB is slow or constraint fails, we're hanging login. Moved to best-effort.
3. **Validation at write time only**: Rejected—would catch bad JSON too late. Now validating shape on read to fail fast.
4. **Storing sanitized JSON in conversation**: Considered—would be safer. Decided against it (too late in cycle); sanitization now happens at materialization time.

## Root Cause Analysis

Why was this needed? The onboarding flow generates scenarios in an anonymous session (conversation stored in `ai_conversations`). When users authenticate, those scenarios were orphaned—lost. This feature retrieves them and creates PERSONAL rows, so they persist.

Why was `difficulty` dropped? Schema drift—it was read inconsistently, defaults weren't respected everywhere, and removing it simplified the model. But it required coordinated code + schema changes.

Why not throw on materialization failure? Auth is critical path. Any exception there is a production incident. By logging structured events instead, we can monitor + debug without affecting user login velocity.

## Lessons Learned

1. **Side-effects in auth are radioactive.** Always wrap in try-catch, never throw. Structured logging (with event name + context) replaces exceptions as the signal.

2. **Schema cleanup timing is underrated.** Removing `difficulty` required changes in 7 files. Starting from `difficulty` reference count would have saved time. Future: grep-and-count before declaring a field "safe to remove."

3. **Regex for HTML sanitization needs test coverage.** The `SCRIPT_STYLE_BLOCKS` pattern strips tag content (not just opening tags), which is necessary for XSS. But it's easy to miss nested edge cases (e.g., escaped quotes). We caught it in tests, but could've used manual XSS fuzzing.

4. **Idempotent operations are insurance.** Using `orIgnore()` means materialization can be retried without duplicating rows. That's cheap safety for a feature that might be called multiple times per session (retry logic, replays, etc.).

5. **Validation early, fail gracefully later.** Validating conversation shape on read prevents bad data from entering the system. Silently skipping (vs. throwing) keeps the user unblocked.

## Next Steps

- [ ] Monitor `onboarding.materialization.*` events in production for 2 weeks; alert on any `fail.*` spike
- [ ] Add e2e test: complete onboarding (chat), log in, verify 5 PERSONAL scenarios exist in user's content
- [ ] Consider: if `RawScenarioJson` structure changes, add version field to conversation metadata to handle migration
- [ ] Future: store sanitized JSON in conversation after materialization (reduces risk of malformed scenarios)
- [ ] Add: link from Lesson → Scenario origin metadata so UX can show "from onboarding" badge

**Owner**: Backend (Auth + AI modules)
**Timeline**: Monitoring phase; next 2 weeks before considering stable
