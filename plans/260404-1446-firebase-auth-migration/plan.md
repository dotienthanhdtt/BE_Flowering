---
title: "Firebase Auth Migration: Google + Apple"
description: "Replace direct Google/Apple token validation with Firebase Auth verification on backend"
status: ready
priority: P2
effort: 3h
branch: feat/firebase-auth-migration
tags: [auth, firebase, google, apple, migration]
created: 2026-04-04
blockedBy: []
blocks: []
---

# Firebase Auth Migration: Google + Apple

## Problem

Current auth validates Google and Apple tokens separately using two different libraries (`google-auth-library`, `apple-signin-auth`). Firebase Auth unifies both into a single SDK, simplifying maintenance and enabling Firebase ecosystem features (analytics, Crashlytics user linking, etc.).

## Scope

- **In scope**: Backend Firebase Admin SDK init + single Firebase token verifier replacing two strategies
- **Out of scope**: Email/password auth, refresh tokens, password reset, Flutter app changes (noted for coordination)

## Phases

| # | Phase | Status | Effort | File |
|---|-------|--------|--------|------|
| 1 | Firebase Admin SDK initialization | ready | 30m | [phase-01](phase-01-firebase-init.md) |
| 2 | Firebase token verification strategy | ready | 45m | [phase-02](phase-02-firebase-strategy.md) |
| 3 | Update auth service + module wiring | ready | 45m | [phase-03](phase-03-auth-service-update.md) |
| 4 | Cleanup: remove old packages + config | ready | 30m | [phase-04](phase-04-cleanup.md) |
| 5 | Testing + build verification | ready | 30m | [phase-05](phase-05-testing.md) |

## Key Dependencies

- `firebase-admin` v13.6.0 (already installed)
- Firebase project configured with Google + Apple sign-in providers enabled
- Firebase env vars set: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- **Flutter app must also migrate** to send Firebase ID tokens (separate effort)

## Architecture Decision

**Single verifier replaces two strategies.** `firebase-admin.auth().verifyIdToken()` returns a `DecodedIdToken` containing:
- `uid` — Firebase user ID
- `email`, `email_verified`
- `firebase.sign_in_provider` — `"google.com"` or `"apple.com"`
- `firebase.identities` — contains original provider UIDs for backward compatibility

## Backward Compatibility

Existing users have native provider UIDs in `google_provider_id`/`apple_provider_id`. Firebase `DecodedIdToken.firebase.identities` contains these same original UIDs:
- `identities["google.com"]` → `["original-google-sub"]`
- `identities["apple.com"]` → `["original-apple-sub"]`

Use these for user lookup — no DB migration needed.

## Risk Notes

- Flutter app and backend must deploy in coordination
- Firebase private key contains newlines — ensure Railway env var handles `\n` correctly
- If Firebase project doesn't have Google/Apple providers enabled, token verification will fail
