# Scout Report — Onboarding "Gift" → Personal Scenario

## TL;DR
**Your mental model doesn't match the current code.** There is **no automatic conversion** of onboarding-generated scenarios into real `Scenario` rows (`type=PERSONAL`) at login time. Both the happy path and the "skip onboarding" edge case end up with **empty `/scenarios/personal`** until the user runs the authenticated `/personalization` intake.

## Actual Flow (Code-Verified)

### Happy path: new user → onboarding → login
1. `POST /onboarding/start` — creates `ai_conversations` row with `type=ANONYMOUS`, no userId. (`onboarding.service.ts:141-158`)
2. `POST /onboarding/chat` — turn-based chat over that conversation.
3. `POST /onboarding/complete` — engine extracts profile + 5 scenarios; persists them as **JSON** on the conversation row (`extractedProfile`, `scenarios` columns), NOT as `Scenario` table rows. (`onboarding.service.ts:107-121`)
4. `POST /auth/firebase` (or similar) with `conversationId` in body — `linkOnboardingSession()`:
   - Flips conversation `type=ANONYMOUS → AUTHENTICATED`, sets `userId` (atomic update, race-safe). (`auth.service.ts:345-373`)
   - Bootstraps `user_languages` row (active learning language). (`auth.service.ts:407-424`)
   - Bootstraps `user.nativeLanguage`. (`auth.service.ts:388-400`)
5. **Stop.** The JSON scenarios on the conversation row are **never materialized** into the `scenarios` table.

### Edge case you raised: new user signs in directly (no onboarding)
- `linkOnboardingSession` skipped (no `conversationId` passed).
- No conversation row, no JSON scenarios, no bootstrap of `user_languages`/`nativeLanguage`.
- `/scenarios/personal` → empty (same outcome as happy path).

## So when does `Scenario` with `type=PERSONAL` get created?
Only via the **authenticated** personalization flow:
- `PersonalizationService` (`personalization.service.ts:146,232-257`) — needs `AiConversationType.PERSONALIZE_INTAKE` conversation, requires JWT user, calls `scenarioRepo.save(generated)` with `type=ScenarioType.PERSONAL`, `ownerId=userId`.

The onboarding `ANONYMOUS → AUTHENTICATED` conversation and the `PERSONALIZE_INTAKE` conversation are **different conversation types and different code paths**.

## Where the Onboarding JSON Scenarios Surface
- `/users/me` profile endpoint (`user.service.ts:95`) returns `conversation.scenarios ?? []` from the latest AUTHENTICATED conversation row with `extractedProfile`. They're shown as profile suggestions, not as PERSONAL scenarios.
- `/onboarding/complete` cache-hit return (`onboarding.service.ts:90-105`) returns them inline.

## Empty-Items Impact on `/scenarios/personal`

| User journey | Personal Scenarios materialized? | `/scenarios/personal` items |
|---|---|---|
| Onboarding completed → login with `conversationId` | **No** | Empty (unless user has KOL gifts) |
| Login directly, skip onboarding | **No** | Empty |
| Login → run `/personalization` intake | **Yes** | Populated |
| Login → redeem KOL gift code | KOL access row created | KOL items shown (still no PERSONAL) |

## Gaps / Likely Missing Feature
If product intent is "onboarding scenarios should become PERSONAL after sign-in":
- Need a materialization step in `linkOnboardingSession` (or a post-login event) that:
  1. Reads `conversation.scenarios` JSON,
  2. Inserts them as `Scenario` rows with `type=PERSONAL`, `ownerId=userId`, `languageId=conversation.languageId`, `status=PUBLISHED`,
  3. Dedupes (re-link is idempotent — atomic update guards already prevent double-claim).
- Suggested location: `auth.service.ts:374` — add a 3rd try-block `materializeOnboardingScenarios(userId, conversation)`.

## Edge Cases Worth Calling Out
1. **Conversation `scenarios` JSON has fewer than 5 entries / parse failed** — onboarding only persists JSON when `scenarios.length === 5` (`onboarding.service.ts:114`). User who completes chat but engine returns bad data → JSON empty → nothing to materialize.
2. **Race during linking** — atomic update at `auth.service.ts:360-369` prevents double-claim, but materialization (if added) must run only on the winning path (`result.affected > 0`).
3. **Language mismatch** — `conversation.languageId` may differ from the active language client sets later. PERSONAL scenarios filtered by `languageId` in `/scenarios/personal` (see prior report `scout-260513-1908-personal-scenarios-empty.md`).
4. **User had no `conversationId` at login** — direct sign-in skips entire bootstrap. They'll also have no `user_languages` row until something else creates it.
5. **Re-login with same `conversationId`** — `affected=0`, no rebootstrap, no remateralization (correct).
6. **User signs in with conversationId belonging to another user (already-claimed)** — guarded by atomic update; no leak.

## Related Files
- `src/modules/onboarding/onboarding.service.ts` — start/chat/complete; persists JSON scenarios
- `src/modules/auth/auth.service.ts:345-401` — `linkOnboardingSession` + bootstrap
- `src/modules/personalization/services/personalization.service.ts:232-257` — only place PERSONAL Scenario rows are created
- `src/modules/scenario/services/scenario-access.service.ts:109-119` — `listPersonalForUser` query
- `src/modules/user/user.service.ts:76-97` — surfaces onboarding JSON in `/users/me`
- `src/database/entities/ai-conversation.entity.ts:86` — `extractedProfile`, `scenarios` JSON columns

## Unresolved Questions
1. Is "onboarding scenarios → PERSONAL Scenario rows" actually a product requirement, or are onboarding scenarios intentionally just profile metadata?
2. If yes, should they auto-publish or stay DRAFT pending user confirmation?
3. Should direct sign-in (no onboarding) trigger an auto-prompt to run `/personalization` intake to seed PERSONAL scenarios?
4. For users who already signed in pre-feature, do we need a backfill that materializes scenarios from existing AUTHENTICATED conversation rows?
