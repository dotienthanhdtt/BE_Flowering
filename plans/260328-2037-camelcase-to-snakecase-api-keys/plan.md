# Plan: Convert API JSON keys from camelCase to snake_case

**Status:** completed
**Priority:** high
**Branch:** refactor/code-cleanup

## Context
Mobile app expects snake_case JSON keys. Backend currently returns camelCase. Instead of modifying 40+ DTO/entity files, transform keys at the API boundary layer — interceptor for responses, middleware for requests.

## Approach: Boundary-layer key transformation

**Why:** KISS — one utility + two integration points. Internal code stays camelCase (TypeScript convention). Only the HTTP layer converts.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Create case-converter utility | completed |
| 2 | Update response interceptor | completed |
| 3 | Add request middleware | completed |
| 4 | Verify build & tests | completed |

## Files

| Action | File |
|--------|------|
| Create | `src/common/utils/case-converter.ts` |
| Edit | `src/common/interceptors/response-transform.interceptor.ts` |
| Edit | `src/main.ts` |

## Phase Details

### Phase 1: Create `src/common/utils/case-converter.ts`
- `camelToSnakeKey("userProfile")` → `"user_profile"`
- `snakeToCamelKey("user_profile")` → `"userProfile"`
- `toSnakeCase(obj)` — recursively convert all object keys
- `toCamelCase(obj)` — recursively convert all object keys
- Handle edge cases: null, undefined, Date, arrays, nested objects

### Phase 2: Update `response-transform.interceptor.ts`
- Apply `toSnakeCase()` to response data **before** wrapping in BaseResponseDto
- `code`, `message`, `data` wrapper keys are single-word — no conversion needed

### Phase 3: Add request body middleware in `main.ts`
- Express middleware (`app.use()`) before ValidationPipe
- Converts incoming snake_case request body keys → camelCase
- Existing DTO validation (camelCase properties) continues working unchanged
- **Exclude webhook routes** — RevenueCat webhook DTOs already use snake_case internally

### Phase 4: Verification
1. `npm run build` — no compile errors
2. `npm test` — all tests pass
3. Confirm response keys are snake_case
4. Confirm webhook endpoint still works

## Edge Cases
- RevenueCat webhook receives raw snake_case → exclude `/webhooks/*` from request middleware
- Date objects → pass through unchanged (not key-converted)
- Arrays → recurse into elements
- Null/undefined → pass through
