# Phase 05 — Test Sweep + Smoke Verification

## Context Links
- All previous phase docs.

## Overview
- **Priority:** P1 (gates ship)
- **Status:** pending
- **Description:** Run full type-check, full test suite, manual smoke against dev API. Verify the original DONE → CHATTING bug is gone.

## Requirements
- `npx tsc --noEmit` clean.
- `npm test` green (or only pre-existing failures explicitly listed).
- `npm run build` clean.
- Manual smoke: scenario completes → re-enter creates new row.
- Manual smoke: anonymous onboarding → Firebase login → `User.nativeLanguage` populated.

## Implementation Steps

1. **Static checks:**
   ```bash
   npx tsc --noEmit -p tsconfig.json
   npm run lint
   npm run build
   ```

2. **Full test run:**
   ```bash
   npm test
   ```
   Resolve any unanticipated `metadata` references in other specs (use `grep -rn "metadata" src/ --include="*.spec.ts"` to spot).

3. **Codebase grep — catch stragglers:**
   ```bash
   grep -rn "conversation\.metadata\|\.metadata as Record" src/ --include="*.ts" | grep -v "langfuse\|llmService\|chat({.*metadata"
   ```
   Expected: zero hits in production code (langfuse `metadata: { feature, ... }` is a separate concept and stays).

4. **Migration verification (against dev DB):**
   ```bash
   npm run migration:run
   psql "$DATABASE_URL" -c "\d ai_conversations"
   psql "$DATABASE_URL" -c "SELECT indexdef FROM pg_indexes WHERE indexname='UQ_ai_conversations_user_scenario_active';"
   ```

5. **Smoke A — scenario chat DONE-then-fresh:**
   - Start a scenario chat in the Flutter app.
   - Reach DONE (12 turns or LLM end-signal).
   - Navigate back to scenario detail, re-enter chat with no `conversationId`.
   - Verify response: new `conversation_id`, `status: CHATTING`, `turn: 0` (or 1 with greeting).

6. **Smoke B — anonymous onboarding bootstrap:**
   - Hit `POST /onboarding/chat` with `{ nativeLanguage: 'vi', targetLanguage: 'en' }`.
   - Verify DB: row has `native_language = 'vi'`, `language_id` matches `en`, `metadata` column does not exist.
   - Complete onboarding, then `POST /auth/firebase` linking the conversation.
   - Verify `User.native_language = 'vi'` post-login.

7. **Run code-reviewer agent** on the diff for sanity.

## Todo List
- [ ] Static checks pass
- [ ] Full test suite green
- [ ] Codebase grep returns zero metadata references
- [ ] Migration applies cleanly to dev DB
- [ ] Smoke A passes
- [ ] Smoke B passes
- [ ] Code review pass

## Success Criteria
All boxes checked. Plan moves to `status: completed` in `plan.md`.

## Risk Assessment
- **Test fixture drift in unrelated specs** — possible. Resolve by fixing as found.
- **Dev DB has data we don't expect** — verify backfill SELECTs return sane row counts before drop.

## Security Considerations
- Verify smoke flow does not log raw conversation data with PII to console — existing logger should handle this.

## Next Steps
- Update `plan.md` status to `completed`.
- Run `/ck:journal` to record outcome.
- Open PR.
