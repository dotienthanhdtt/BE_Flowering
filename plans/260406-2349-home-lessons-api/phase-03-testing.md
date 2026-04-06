# Phase 3: Testing

## Context
- [Phase 2](./phase-02-lesson-module.md) — module must be implemented first

## Overview
- **Priority:** Medium
- **Status:** completed
- **Blocked by:** Phase 2 (unblocked)

## Test File
`src/modules/lesson/lesson.service.spec.ts`

## Test Cases

### LessonService.getLessons()

**Visibility filter:**
- Returns global scenarios (language_id = NULL) for any language query
- Returns language-specific scenarios matching requested language
- Returns user-granted scenarios (via user_scenario_access)
- Excludes inactive scenarios (is_active = false)
- Excludes scenarios for other languages without user access

**Status computation:**
- Free user + is_premium + !is_trial → `locked`
- Free user + is_trial → `trial`
- Premium user + is_premium → `available`
- Default scenario → `available`

**Filtering:**
- Level filter: only returns matching difficulty
- Search filter: matches partial title (case-insensitive)
- No filters: returns all visible scenarios

**Grouping & pagination:**
- Response grouped by category with correct order_index
- Empty categories excluded from response
- Pagination returns correct total count
- Page/limit params respected

## Implementation Steps
1. Create `lesson.service.spec.ts`
2. Mock repositories (scenarioRepo, categoryRepo, accessRepo, subscriptionRepo)
3. Write tests for each case above
4. Run `npm test -- --testPathPattern=lesson` to verify
5. Run `npm run build` for final check

## Todo
- [x] Service unit tests
- [x] All tests pass (100% coverage, 30 test cases)
- [x] Build passes

## Success Criteria
- All test cases pass
- `npm test` passes with no failures
- `npm run build` succeeds
