---
phase: 5
title: "Testing + Build Verification"
status: completed
priority: high
effort: 30m
completed: 2026-04-04
---

# Phase 5: Testing + Build Verification

## Implementation Steps

### 1. Build verification

```bash
npm run build
```

### 2. Run tests + lint

```bash
npm test
npm run lint
```

Fix any breakages: tests mocking old strategies/DTOs must be updated.

### 3. Manual smoke test

- [ ] `POST /auth/firebase` with Google Firebase ID token → returns JWT + user
- [ ] `POST /auth/firebase` with Apple Firebase ID token → returns JWT + user
- [ ] `POST /auth/google` → 404 (removed)
- [ ] `POST /auth/apple` → 404 (removed)
- [ ] `POST /auth/login` → still works (unchanged)
- [ ] `POST /auth/register` → still works (unchanged)
- [ ] `POST /auth/refresh` → still works (unchanged)

## Flutter Coordination

Flutter app must update to:
1. Use `firebase_auth` SDK for sign-in
2. Send Firebase ID token to `POST /auth/firebase` (not `/auth/google` or `/auth/apple`)
3. Deploy together with backend
