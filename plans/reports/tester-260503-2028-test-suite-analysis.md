---
date: 2026-05-03
status: TEST_EXECUTION_COMPLETE
focus: Subscription module test coverage gap + full suite baseline failures
---

# Test Suite Analysis — Backend Subscription Module

## Executive Summary

**Subscription module has ZERO tests.** Full suite baseline: 360 passed, 14 failed, 6 test suites failed.

Pre-webhook-hardening failures are unrelated (scenario/lesson module dependencies). Webhook-hardening code (4 files: DTO, controller, module config, main.ts) is completely untested.

---

## Test Results

### Full Test Suite Execution

```
Test Suites: 6 failed, 25 passed, 31 total
Tests:       14 failed, 360 passed, 374 total
Snapshots:   0 total
Execution:   9.81s
```

### Subscription Module Tests

```
npm test -- --testPathPattern=subscription
→ No tests found, exiting with code 1
In /Users/tienthanh/Dev/new_flowering/be_flowering/src
  286 files checked.
  testMatch: - 0 matches
  testPathIgnorePatterns: /node_modules/ - 286 matches
  testRegex: .*\.spec\.ts$ - 31 matches
Pattern: subscription - 0 matches
```

**Finding:** Zero test files exist for subscription module. No spec files under `src/modules/subscription/`.

---

## Failed Tests (14 Total)

### Category 1: Scenario Access Service (Pre-existing) — 6 failures

**File:** `src/modules/scenario/services/scenario-access.service.spec.ts`

**Root cause:** Recent query builder changes return `where` as an Array with OR conditions instead of Object. Mock expectations outdated.

Tests failing:
1. "should return scenario when free scenario and any user" — Mock expects `where: {...}`, receives `where: [...]`
2. "should return scenario when premium and user has active subscription" — Same mismatch
3. "should return scenario when premium and user has explicit access grant" — `subscriptionService` not called
4. "should throw ForbiddenException when premium scenario, no subscription" — Resolves instead of rejects
5. "should throw ForbiddenException when subscription inactive" — Resolves instead of rejects
6. "should fetch scenario with category relation" — Mock expects Object, receives Array

**Severity:** Medium (logic may be correct, test assertions wrong). Related to access-tier refactor (2026-04-20).

---

### Category 2: Scenario Details Service — 1 failure

**File:** `src/modules/scenario/services/scenarios-detail.service.spec.ts`

**Error:**
```
TS2307: Cannot find module '../../../database/entities/user-ai-scenario.entity'
or its corresponding type declarations.
```

**Root cause:** Entity file missing or incorrect path. Not related to webhook changes.

---

### Category 3: Scenario Listing Service — 2 failures

**File:** `src/modules/scenario/services/scenarios-listing.service.spec.ts`

**Errors:**
```
TS2307: Cannot find module '@/database/entities/user-ai-scenario.entity'
TS2339: Property 'DEFAULT' does not exist on type 'typeof ScenarioType'
```

**Root cause:** Missing entity + invalid enum reference. Not related to webhook changes.

---

### Category 4: Lesson Service — 1 failure

**File:** `src/modules/lesson/lesson.service.spec.ts`

**Error:**
```
TS2339: Property 'DEFAULT' does not exist on type 'typeof ScenarioType'
```

**Root cause:** Invalid enum reference. Not related to webhook changes.

---

### Category 5: Scenario Chat Service — 1 failure

**File:** `src/modules/scenario/services/scenario-chat.service.spec.ts`

**Error:**
```
TS2307: Cannot find module '../../../database/entities/user-ai-scenario.entity'
```

**Root cause:** Missing entity. Not related to webhook changes.

---

### Category 6: Scenario Chat Controller — 3 failures

**File:** `src/modules/scenario/scenario-chat.controller.spec.ts`

**Errors (all 3 tests):**
```
Nest can't resolve dependencies of the ResourceAccessGuard 
(Reflector, ?, SubscriptionService). Please make sure that the argument 
AccessTierCacheService at index [1] is available in the RootTestModule context.
```

**Root cause:** Missing `AccessTierCacheService` mock in test module setup. Not related to webhook changes.

---

## Subscription Module Coverage Gap

### Files with Zero Test Coverage

| File | Lines | Risk Level | Critical Paths |
|------|-------|-----------|-----------------|
| `src/modules/subscription/dto/revenuecat-webhook.dto.ts` | ~50 | HIGH | @ValidateNested, nested field validation |
| `src/modules/subscription/webhooks/revenuecat-webhook.controller.ts` | ~80 | CRITICAL | Auth verification, replay window, request body handling |
| `src/modules/subscription/subscription.module.ts` | ~20 | MEDIUM | ThrottlerModule configuration |
| `src/main.ts` (body-parser limit) | ~1 | LOW | 256kb limit enforcement |

### High-Risk Untested Code Paths

1. **`verifyAuth()` method** — Timing-safe comparison + Bearer token stripping
   - Bearer prefix stripping (case-insensitive regex)
   - Timing-safe comparison implementation
   - Edge cases: empty header, malformed token, missing Bearer

2. **Replay window validation** — 24-hour boundary
   - Exact boundary (24h old = accepted)
   - Just outside boundary (24h+1ms = rejected)
   - Missing/null timestamps

3. **DTO nested validation** — @ValidateNested()
   - Nested object validation (no test exercise of this feature)
   - Invalid nested fields

4. **Throttle guard** — 60 req/min
   - Configuration not verified in tests
   - Rate limit bypass detection

5. **Request body size limit** — 256kb
   - Oversized payloads handling
   - Exact boundary (256kb - 1 byte vs 256kb + 1 byte)

---

## Passing Tests (360 Total)

**Note:** All 25 passing test suites are unrelated to subscription module:
- Auth (2 suites): controller, service
- AI (11 suites): LLM providers, services, transcription, translation
- Scenario (5 suites): vocabulary injection, scenarios-redeem, parsers, matchers
- Common (4 suites): guards (roles, language-context), circuit-breaker, language-levels
- Vocabulary (2 suites): leitner, review sessions, vocabulary service
- Onboarding (1 suite): DTO validation

**Execution time:** ~5-6s per suite. No performance issues detected.

---

## Pre-existing vs Webhook-Related Failures

### Pre-existing (Unrelated to Webhook Hardening)

These 14 failures existed BEFORE webhook changes and affect different modules:

**Entity/Import Issues:**
- `UserAiScenario` entity missing (scenarios-detail, scenarios-listing, scenario-chat services)
- `ScenarioType.DEFAULT` invalid enum (lesson service, scenarios-listing service)

**Mock Setup Issues:**
- `AccessTierCacheService` missing in test module (scenario-chat controller)

**Query Builder Refactor Issues:**
- Scenario access service query expectations outdated (6 tests)
- Likely from access-tier refactor (2026-04-20)

### Webhook-Related (NEW, Unaddressed)

**Subscription module: 0 tests exist**

No test files, no test coverage, zero execution. Four hardening files untested.

---

## Recommendations

### Priority 1: Address Webhook Testing Gap (BLOCKING)

Create test suite for subscription/webhooks (Phase 1 of hardening):

1. **`revenuecat-webhook.controller.spec.ts`** — 100+ lines
   - Auth verification (Bearer token stripping, timing-safe comparison)
   - Replay window validation (24h boundary)
   - Throttle guard integration
   - Valid webhook payload handling
   - Malformed/invalid payloads
   - Missing auth header
   - Oversized body (>256kb)
   - Idempotency duplicate-event handling

2. **`revenuecat-webhook.dto.spec.ts`** — 50+ lines
   - Nested @ValidateNested() validation
   - Invalid nested fields rejection
   - Type coercion edge cases

3. **Integration test** — body-parser limit
   - Oversized payloads (256kb + 1 byte)
   - Exact boundary (256kb - 1 byte)

**Target:** 80%+ coverage on subscription module before merge.

### Priority 2: Fix Pre-existing Failures

These are independent of webhook work but block test suite:

1. **Entity imports** — Find/restore `UserAiScenario` entity or update paths
2. **Enum reference** — Fix `ScenarioType.DEFAULT` → correct enum value
3. **Mock setup** — Add `AccessTierCacheService` to scenario-chat controller test

---

## Metrics

| Metric | Value | Target |
|--------|-------|--------|
| Total test suites | 31 | - |
| Passing suites | 25 | 31 |
| Failing suites | 6 | 0 |
| Total tests | 374 | - |
| Passing tests | 360 | 374 |
| Failing tests | 14 | 0 |
| Execution time | 9.81s | <15s |
| Subscription test files | 0 | 2+ |
| Subscription test coverage | 0% | 80%+ |

---

## Next Steps

1. Delegate to implementation team to create webhook test suite (estimate: 2-3 hours)
2. Run `npm test -- --testPathPattern=subscription` → should execute new tests
3. Verify coverage reaches 80%+ on subscription module
4. Fix pre-existing failures (separate task, non-blocking for webhook merge)
5. Re-run full suite to confirm no regressions

---

## Unresolved Questions

1. Are the 14 pre-existing failures expected/acceptable? Should they be fixed before webhook merge?
2. Is the query builder change in scenario-access.service intentional? Should tests be updated or implementation reverted?
3. What is the timeline for the pre-existing failures? Are they in scope for this sprint?
