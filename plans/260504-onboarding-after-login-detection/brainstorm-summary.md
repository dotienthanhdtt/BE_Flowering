# Onboarding-After-Login Detection — Design Summary

**Date:** 2026-05-04
**Status:** Design approved, ready for `/ck:plan`
**Scope:** Backend (`be_flowering`) + mobile (`app_flowering`)

---

## Problem

New users who sign in via OAuth (Google/Apple/Firebase) without going through anonymous onboarding land in an undefined state:

- `User.native_language` = null
- No `user_languages` row
- No personalization profile (lives on `ai_conversations.extracted_profile`)

Mobile needs a deterministic way to know "this user must onboard now" right after login.

---

## Approaches Evaluated

| Option | Verdict |
|---|---|
| **A. Client-side null checks** on `/users/me` fields | Rejected — rule rots across clients, drifts as fields evolve |
| **B. Backend exposes `onboardingRequired` flag** in `/users/me` | **Chosen** — single source of truth, KISS for client |
| **C. Persisted `onboarding_status` enum** with full lifecycle | YAGNI right now — no re-onboarding requirement |

---

## Final Solution

### Backend rule

`onboardingRequired = true` if **any** of:

1. `users.native_language IS NULL`
2. No `user_languages` row for the user
3. `users.onboarding_completed_at IS NULL` (new column — flag that onboarding chat profile was extracted)

### Schema change (one new column)

```sql
ALTER TABLE users ADD COLUMN onboarding_completed_at timestamptz NULL;
```

- Set in `POST /onboarding/complete` (and inside `linkOnboardingSession`) when `extracted_profile` is successfully written to the conversation.
- The `extracted_profile` jsonb stays where it is (`ai_conversations`) — we only flag completion on `User`. No data duplication.
- **Not reusing** `personalization_profile_snapshot` — that column is for the personalization de-dup gate, different feature. Keep semantics clean.

### `/users/me` response shape (additive, non-breaking)

```jsonc
{
  "id": "...",
  "email": "...",
  "displayName": "...",
  "avatarUrl": "...",
  "nativeLanguage": null,           // existing
  "activeLanguage": null,           // existing
  "createdAt": "...",
  "onboardingRequired": true,       // NEW
  "missingFields": [                // NEW — optional, helps UX hints
    "nativeLanguage",
    "userLanguage",
    "onboardingProfile"
  ]
}
```

### Mobile flow

```
login → POST /users/me
  ├─ onboardingRequired = false → home screen
  └─ onboardingRequired = true  → push onboarding stack
                                    └─ on complete → POST /onboarding/complete
                                                       (then linkOnboardingSession)
```

Mobile **only reads `onboardingRequired`**. It does not interpret individual nulls — backend owns the rule.

---

## Files Likely Touched (rough)

**Backend:**
- `src/database/migrations/<new>-add-onboarding-completed-at.ts` — new migration
- `src/database/entities/user.entity.ts` — add `onboardingCompletedAt` field
- `src/modules/user/dto/user-profile.dto.ts` — add `onboardingRequired`, `missingFields`
- `src/modules/user/user.service.ts` — compute flag in `getProfile`
- `src/modules/onboarding/onboarding.service.ts` — set `onboardingCompletedAt` on `complete`
- `src/modules/auth/auth.service.ts` — set `onboardingCompletedAt` inside `linkOnboardingSession` (when extracted_profile present)
- Tests: `user.service.spec.ts`, `onboarding.service.spec.ts`, `auth.service.spec.ts`

**Mobile:**
- DTO model for `/users/me` response — add `onboardingRequired`
- Post-login router/guard — branch on the flag
- Remove any client-side null-checking that duplicates the rule

**Docs:** update `be_flowering/CLAUDE.md` (the "anonymous onboarding / in-memory" line is already stale) and `docs/api-documentation.md`.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Existing users in DB have all 3 conditions met but `onboarding_completed_at` is null → they get sent back to onboarding | Migration backfill: `UPDATE users SET onboarding_completed_at = NOW() WHERE native_language IS NOT NULL AND id IN (SELECT user_id FROM user_languages) AND id IN (SELECT user_id FROM ai_conversations WHERE extracted_profile IS NOT NULL)` |
| Race: user calls `/users/me` mid-onboarding | Acceptable — flag flips only at completion; intermediate calls correctly return `true` |
| Adding a new required field later means changing the rule on backend | That's the point. One place to change. |
| `/users/me` is `POST` (unusual) | Out of scope. Flag this for cleanup later, don't block on it. |

---

## Success Criteria

- A fresh OAuth user who never onboarded → `/users/me` returns `onboardingRequired: true` with all three `missingFields`.
- After completing onboarding → `/users/me` returns `onboardingRequired: false`, `missingFields: []`.
- Existing onboarded users in DB after backfill → `onboardingRequired: false`.
- No regression in `auth.service.spec.ts` `bootstrapUserLanguage` tests.

---

## Out of Scope (deferred)

- Re-onboarding flow (changing native language, adding a new target language)
- Persisted `onboarding_status` enum lifecycle
- Promoting `extracted_profile` jsonb onto `User` (only flag, no data copy)
- Fixing `POST /users/me` → `GET /users/me`

---

## Next Step

Run `/ck:plan` with this summary as context to produce phased implementation plan.
