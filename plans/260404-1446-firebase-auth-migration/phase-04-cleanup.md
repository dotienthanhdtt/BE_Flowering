---
phase: 4
title: "Cleanup: Remove Old Packages + Config"
status: ready
priority: medium
effort: 30m
---

# Phase 4: Cleanup — Remove Old Packages + Config

## Context Links
- [Plan overview](plan.md)
- [package.json](../../package.json)
- [App configuration](../../src/config/app-configuration.ts) — `oauth` block lines 28-35, 75-83

## Overview

Remove the two replaced packages and clean up unused OAuth config entries. Keep Firebase config, remove direct OAuth config.

## Implementation Steps

### 1. Remove npm packages

```bash
npm uninstall google-auth-library apple-signin-auth
npm uninstall @types/apple-signin-auth  # if exists in devDependencies
```

### 2. Delete old strategy files

- `src/modules/auth/strategies/google-id-token-validator.strategy.ts`
- `src/modules/auth/strategies/apple.strategy.ts`

### 3. Clean up `app-configuration.ts`

Remove from `AppConfiguration` interface:
```typescript
// Remove:
oauth: {
  google: {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
  };
  apple: {
    clientId: string;
  };
};
```

Remove from config factory:
```typescript
// Remove:
oauth: {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || '',
  },
  apple: {
    clientId: process.env.APPLE_CLIENT_ID || '',
  },
},
```

### 4. Clean up `.env.example`

Remove these env vars if present:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `APPLE_CLIENT_ID`

Keep Firebase env vars:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

### 5. Check for remaining references

```bash
grep -r "google-auth-library\|apple-signin-auth\|GoogleIdTokenStrategy\|AppleStrategy\|oauth\.google\|oauth\.apple" src/ --include="*.ts"
```

Must return zero results.

## Todo List

- [ ] Uninstall old packages
- [ ] Delete old strategy files
- [ ] Remove `oauth` from `AppConfiguration` interface + factory
- [ ] Update `.env.example`
- [ ] Grep for stale references
- [ ] Verify build: `npm run build`

## Success Criteria

- No references to old packages or strategies remain
- `oauth` config block fully removed
- Build passes
- `package-lock.json` updated (no `google-auth-library` or `apple-signin-auth`)
