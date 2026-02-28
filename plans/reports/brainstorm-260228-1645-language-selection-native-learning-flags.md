# Brainstorm: Language Selection — Native/Learning Flags

**Date:** 2026-02-28
**Status:** Agreed — ready for implementation plan

## Problem Statement

The `languages` table has no distinction between languages available as native vs learning options. Users also lack an API endpoint to set their native language. Need to add availability flags and a native language selection endpoint.

## Evaluated Approaches

### Flag Design

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Two booleans** (`is_native_available`, `is_learning_available`) | Simple, queryable, matches existing `is_active` pattern, flexible | 2 columns instead of 1 | **Selected** |
| Single enum (`native\|learning\|both`) | Compact, single column | Harder to query independently, less flexible for future states | Rejected |

### API Shape

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Separate endpoints** | Uses existing patterns, no new combined logic, clear responsibility | 2 calls during onboarding | **Selected** |
| Combined endpoint | One call for onboarding | New pattern, mixes concerns | Rejected |
| Both options | Flexibility | Over-engineering, YAGNI | Rejected |

### List Filtering

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Query param filter** (`?type=native\|learning`) | Server-side filtering, less data transfer, clean API | Slightly more server logic | **Selected** |
| Return all with flags | Simpler backend | Client must filter, exposes internal flags unnecessarily | Rejected |

### Native Language Endpoint Location

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **`PATCH /languages/user/native`** | Keeps language APIs together, clear intent | New endpoint | **Selected** |
| `PATCH /user/profile` | Groups with user settings | Mixes concerns | Rejected |

## Final Agreed Solution

### Database Changes
- Add `is_native_available BOOLEAN DEFAULT true` to `languages` table
- Add `is_learning_available BOOLEAN DEFAULT true` to `languages` table

### Entity Changes
- Add `isNativeAvailable` and `isLearningAvailable` to `Language` entity

### DTO Changes
- Update `LanguageDto` to include new flags in response
- Add `LanguageQueryDto` with optional `type` query param

### API Changes

| Endpoint | Method | Auth | Change |
|---|---|---|---|
| `/languages` | GET | Public | Add `?type=native\|learning` query filter |
| `/languages/user/native` | PATCH | JWT | **New** — set user's native language |
| `/languages/user` | POST | JWT | Add validation: must be `isLearningAvailable` |

### Validation Rules
- `PATCH /languages/user/native` rejects if language not `isNativeAvailable`
- `POST /languages/user` rejects if language not `isLearningAvailable`

### Migration
- Additive only, `DEFAULT true` — no breaking changes to existing data

## Implementation Scope
1. Migration file: add 2 columns
2. Language entity: 2 new fields
3. DTOs: update response DTO + add query DTO
4. Controller: query filter + new native endpoint
5. Service: filter logic + native setter + validation
6. Tests
7. API docs

## Risk Assessment
- **Low risk** — additive changes, no breaking changes
- Default `true` means all existing languages remain fully available
- Existing learning flow unchanged, just adds validation

## Next Steps
- Create detailed implementation plan
