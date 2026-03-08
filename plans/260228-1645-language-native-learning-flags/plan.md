---
title: "Language Native/Learning Availability Flags"
description: "Add native/learning flags to languages table and selection API endpoints"
status: pending
priority: P2
effort: 2h
branch: feat/auth-improvements-onboarding-linking
tags: [language, api, database, migration]
created: 2026-02-28
---

# Language Native/Learning Availability Flags

## Summary

Add `is_native_available` and `is_learning_available` boolean columns to the `languages` table so the client can distinguish which languages are selectable as native vs learning targets. Add query param filter to `GET /languages` and a new `PATCH /languages/user/native` endpoint for setting native language.

Based on: [brainstorm report](../reports/brainstorm-260228-1645-language-selection-native-learning-flags.md)

## Phases

| # | Phase | Status | Effort | File |
|---|-------|--------|--------|------|
| 1 | Database Migration & Entity Update | pending | 20m | [phase-01](phase-01-database-migration-and-entity.md) |
| 2 | DTOs & Validation | pending | 20m | [phase-02](phase-02-dtos-and-validation.md) |
| 3 | Service & Controller Logic | pending | 40m | [phase-03](phase-03-service-and-controller-logic.md) |
| 4 | Tests & API Docs | pending | 40m | [phase-04](phase-04-tests-and-api-docs.md) |

## Key Dependencies

- Existing `Language` entity at `src/database/entities/language.entity.ts`
- Existing `User` entity with `nativeLanguageId` FK already in place
- `LanguageService`, `LanguageController` in `src/modules/language/`
- Migration timestamp must be > `1740100000000` (latest existing)

## Success Criteria

- [ ] Migration adds 2 boolean columns with `DEFAULT true`
- [ ] `GET /languages?type=native` returns only `isNativeAvailable` languages
- [ ] `GET /languages?type=learning` returns only `isLearningAvailable` languages
- [ ] `GET /languages` (no param) returns all active languages (backward compatible)
- [ ] `PATCH /languages/user/native` sets user's native language with validation
- [ ] `POST /languages/user` validates `isLearningAvailable` before adding
- [ ] Unit tests pass for all new service methods
- [ ] API docs generated at `docs/api/language-api.md`

## Risk Assessment

- **Low risk** -- additive changes only, `DEFAULT true` preserves existing behavior
- No breaking changes to existing endpoints or data
- User entity already has `nativeLanguageId` column -- no user migration needed
