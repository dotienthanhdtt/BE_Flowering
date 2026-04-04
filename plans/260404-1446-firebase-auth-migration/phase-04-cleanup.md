---
phase: 4
title: "Cleanup: Remove Old Packages, Strategies, DTOs, Config"
status: completed
priority: medium
effort: 30m
completed: 2026-04-04
---

# Phase 4: Cleanup

## Overview

Remove all remnants of the old direct Google/Apple auth: packages, strategy files, DTO files, oauth config.

## Implementation Steps

### 1. Remove npm packages

```bash
npm uninstall google-auth-library apple-signin-auth
```

### 2. Delete old files

- `src/modules/auth/strategies/google-id-token-validator.strategy.ts`
- `src/modules/auth/strategies/apple.strategy.ts`
- `src/modules/auth/dto/google-auth.dto.ts`
- `src/modules/auth/dto/apple-auth.dto.ts`

### 3. Clean up `app-configuration.ts`

Remove `oauth` block from interface and factory (clientId, clientSecret, callbackUrl for Google; clientId for Apple).

### 4. Clean up `.env.example`

Remove: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `APPLE_CLIENT_ID`
Keep: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

### 5. Verify no stale references

```bash
grep -r "google-auth-library\|apple-signin-auth\|GoogleIdTokenStrategy\|AppleStrategy\|GoogleAuthDto\|AppleAuthDto\|oauth\.google\|oauth\.apple\|auth/google\|auth/apple" src/ --include="*.ts"
```

Must return zero results.

## Todo List

- [ ] Uninstall old packages
- [ ] Delete old strategy + DTO files
- [ ] Remove `oauth` config block
- [ ] Update `.env.example`
- [ ] Grep for stale references
- [ ] Verify build: `npm run build`
