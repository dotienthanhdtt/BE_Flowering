---
title: "Auth Improvements: Composite Tokens, Google SDK, Auto-Link"
description: "Fix 3 critical/high auth issues: O(n) refresh token scan, Google OAuth mobile flow, account auto-linking"
status: completed
priority: P1
effort: 2.5h
branch: feat/auth-improvements-onboarding-linking
tags: [auth, security, oauth, performance, migration]
created: 2026-02-24
---

# Auth Improvements + Onboarding Linking

**Brainstorm:** [brainstorm report](../reports/brainstorm-260224-1322-auth-improvements-onboarding-linking.md)

## Problem

1. **Refresh token O(n) scan (CRITICAL)** - loads ALL tokens, bcrypt compares each
2. **Google OAuth redirect flow (HIGH)** - doesn't work on mobile, can't pass sessionToken
3. **OAuth email conflict (HIGH)** - throws error instead of auto-linking accounts

## Phases

| # | Phase | Status | Effort | File |
|---|-------|--------|--------|------|
| 1 | Database migration | completed | 30m | [phase-01](phase-01-database-migration.md) |
| 2 | Refresh token composite format | completed | 30m | [phase-02](phase-02-refresh-token-composite.md) |
| 3 | Google idToken endpoint + cleanup | completed | 45m | [phase-03](phase-03-google-idtoken-endpoint.md) |
| 4 | Auto-link OAuth accounts | completed | 30m | [phase-04](phase-04-auto-link-oauth-accounts.md) |
| 5 | Update tests | completed | 30m | [phase-05](phase-05-update-tests.md) |

## Key Dependencies

- `google-auth-library` npm package (for Google ID token verification)
- Migration must run before code deploys (new columns required)

## Final Decisions (from brainstorm)

1. **Remove** Passport redirect Google flow entirely — only `POST /auth/google` with idToken
2. **Force logout** all users on deploy — revoke all refresh tokens in migration
3. **Migrate** existing `authProvider`/`providerId` data to new provider-specific columns

## Risk Notes

- Migration is backward-compatible (nullable columns)
- Force logout = clean break, no dual-format token handling needed
- Google auth library may already be available via Google AI deps — check before installing
