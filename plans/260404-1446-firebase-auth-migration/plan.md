---
title: "Firebase Auth Migration: Unified Endpoint"
description: "Replace POST /auth/google + POST /auth/apple with single POST /auth/firebase using Firebase Admin SDK"
status: completed
priority: P2
effort: 3h
branch: feat/firebase-auth-migration
tags: [auth, firebase, google, apple, migration]
created: 2026-04-04
completed: 2026-04-04
blockedBy: []
blocks: []
---

# Firebase Auth Migration: Unified Endpoint

## Problem

Current auth has two separate endpoints (`POST /auth/google`, `POST /auth/apple`) with two different libraries. Firebase Auth unifies both into a single SDK and single endpoint.

## Scope

- **In scope**: Single `POST /auth/firebase` endpoint replacing both Google and Apple endpoints
- **Out of scope**: Email/password auth, refresh tokens, password reset, Flutter app changes

## Phases

| # | Phase | Status | Effort | File |
|---|-------|--------|--------|------|
| 1 | Firebase Admin SDK initialization | completed | 30m | [phase-01](phase-01-firebase-init.md) |
| 2 | Firebase token verification strategy | completed | 45m | [phase-02](phase-02-firebase-strategy.md) |
| 3 | Unified endpoint + service + DTO | completed | 45m | [phase-03](phase-03-auth-service-update.md) |
| 4 | Cleanup: remove old packages + config | completed | 30m | [phase-04](phase-04-cleanup.md) |
| 5 | Testing + build verification | completed | 30m | [phase-05](phase-05-testing.md) |

## Key Dependencies

- `firebase-admin` v13.6.0 (already installed)
- Firebase project configured with Google + Apple sign-in providers enabled
- Firebase env vars set: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- **Flutter app must also migrate** to send Firebase ID tokens to `POST /auth/firebase`

## Architecture Decision

**Single endpoint, single verifier.**

- `POST /auth/firebase` accepts `{ idToken, displayName?, conversationId? }`
- `FirebaseTokenStrategy.validate()` verifies token and extracts provider type automatically
- Provider (`google`/`apple`) determined from `firebase.sign_in_provider` in decoded token
- Existing `oauthLogin()` flow handles find/link/create — unchanged

### API Change

| Before | After |
|--------|-------|
| `POST /auth/google` `{ idToken }` | **Removed** |
| `POST /auth/apple` `{ idToken }` | **Removed** |
| — | `POST /auth/firebase` `{ idToken }` |

## Backward Compatibility

Existing users have native provider UIDs in `google_provider_id`/`apple_provider_id`. Firebase `DecodedIdToken.firebase.identities` contains these same original UIDs — no DB migration needed.

## Risk Notes

- **Breaking API change**: Flutter app must update endpoint from `/auth/google` or `/auth/apple` to `/auth/firebase`
- Flutter app and backend must deploy together
- Firebase private key newlines — Railway env var must handle `\n`
