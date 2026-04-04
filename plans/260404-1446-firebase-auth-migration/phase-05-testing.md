---
phase: 5
title: "Testing + Build Verification"
status: ready
priority: high
effort: 30m
---

# Phase 5: Testing + Build Verification

## Context Links
- [Plan overview](plan.md)
- [Auth service](../../src/modules/auth/auth.service.ts)

## Overview

Run existing tests, fix any breakages from the migration, verify build compiles for Railway deployment.

## Implementation Steps

### 1. Build verification

```bash
npm run build
```

Must pass with zero errors. This catches:
- Missing imports
- Type mismatches
- Removed references still used somewhere

### 2. Run existing tests

```bash
npm test
```

Fix any test failures related to:
- Tests mocking `GoogleIdTokenStrategy` or `AppleStrategy` — update to mock `FirebaseTokenStrategy`
- Tests importing removed strategy files
- Tests referencing `oauth` config

### 3. Run linter

```bash
npm run lint
```

### 4. Manual smoke test checklist

If dev server is available:
- [ ] `POST /auth/google` with Firebase ID token → returns JWT
- [ ] `POST /auth/apple` with Firebase ID token → returns JWT
- [ ] `POST /auth/login` with email/password → still works (unchanged)
- [ ] `POST /auth/register` → still works (unchanged)
- [ ] `POST /auth/refresh` → still works (unchanged)

## Todo List

- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] Fix any test breakages from migration

## Success Criteria

- Build compiles without errors
- All existing tests pass (updated for new strategy)
- Lint passes
- No regressions in email/password auth flow

## Flutter Coordination Note

Backend is ready after this phase. Flutter app must:
1. Add `firebase_auth` + `google_sign_in` / `sign_in_with_apple` packages
2. Sign in via Firebase, obtain Firebase ID token
3. Send Firebase ID token to `POST /auth/google` or `POST /auth/apple`

Both apps should deploy together to avoid auth failures.
