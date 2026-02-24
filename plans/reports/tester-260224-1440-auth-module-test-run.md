# Auth Module Test Report
**Date:** 2026-02-24 14:40
**Status:** PARTIAL FAILURE - Auth Service tests pass, Auth Controller tests fail

---

## Test Results Overview

| Metric | Result |
|--------|--------|
| **Total Test Suites** | 4 (1 failed, 3 passed) |
| **Total Tests** | 38 passed, 0 failed* |
| **Auth Service Tests** | 26/26 passed ✓ |
| **Auth Controller Tests** | COMPILATION ERRORS ✗ |
| **Onboarding Tests** | 12/12 passed ✓ |
| **Execution Time** | 4.6 seconds |

*Note: Auth Controller tests don't run due to TypeScript compilation errors before execution.

---

## Detailed Results

### 1. AuthService Tests (PASS) ✓
**File:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/auth/auth.service.spec.ts`

**All 26 tests passed:**

#### register
- ✓ should successfully register new user
- ✓ should throw ConflictException if email already exists

#### login
- ✓ should successfully login with valid credentials
- ✓ should throw UnauthorizedException if user not found
- ✓ should throw UnauthorizedException if password invalid
- ✓ should throw UnauthorizedException if user has no password hash

#### googleLogin
- ✓ should create new user on first-time Google login
- ✓ should login existing Google user by provider ID
- ✓ should auto-link Google account to existing email user
- ✓ should pass sessionToken to onboarding linking

#### appleLogin
- ✓ should create new user for first-time Apple login
- ✓ should login existing Apple user by provider ID
- ✓ should auto-link Apple account to existing email user

#### refreshTokens
- ✓ should successfully refresh with valid composite token
- ✓ should throw UnauthorizedException for malformed token (no colon)
- ✓ should throw UnauthorizedException for token with empty tokenId
- ✓ should throw UnauthorizedException for token with empty secret
- ✓ should throw UnauthorizedException if tokenId not found in DB
- ✓ should throw UnauthorizedException if token is expired
- ✓ should throw UnauthorizedException if secret does not match hash

#### generateTokens
- ✓ should return composite refresh token in uuid:hex format

#### logout
- ✓ should revoke all user refresh tokens

#### register with sessionToken (onboarding linking)
- ✓ calls linkOnboardingSession after user creation when sessionToken provided
- ✓ does not call linkOnboardingSession when no sessionToken provided

#### linkOnboardingSession (via register)
- ✓ logs warning when no matching anonymous session found (affected=0)
- ✓ logs warning on error and does not throw

**Coverage:** 98.92% statements, 100% branches, 95.83% functions

---

### 2. AuthController Tests (COMPILATION ERROR) ✗
**File:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/auth/auth.controller.spec.ts`

**Status:** Tests cannot execute. 9 TypeScript compilation errors blocking test suite.

#### Errors Found

| Error | Line | Type | Issue |
|-------|------|------|-------|
| Cannot find module `./strategies/google.strategy` | 7 | Import | Module does not exist; file references non-existent export |
| Expected 1 argument (dto), got 0 | 125 | Call | `controller.googleAuth()` missing required `GoogleAuthDto` parameter |
| Property `oauthLogin` is private | 142, 159 | Access | Cannot mock private method; test tries to mock internal service method |
| Property `googleCallback` doesn't exist | 144, 163 | Method | Controller has no `googleCallback` method (doesn't exist in `auth.controller.ts`) |

#### Root Causes

1. **Missing Import:** Test imports `GoogleUser` from non-existent `./strategies/google.strategy`. Check: does this file exist?
   - Search result: File not found in codebase

2. **API Signature Mismatch:** Test calls `controller.googleAuth()` with no arguments
   - **Actual signature (line 39):** `async googleAuth(@Body() dto: GoogleAuthDto): Promise<AuthResponseDto>`
   - **Test expects:** parameterless method call

3. **Deprecated Test Code:** Tests reference:
   - `authService.oauthLogin` (private method - cannot mock)
   - `controller.googleCallback` (non-existent endpoint)
   - Old OAuth strategy pattern not in current controller

4. **Controller API Changed:** Current controller uses:
   - `POST /auth/google` with `GoogleAuthDto` body
   - `POST /auth/apple` with `AppleAuthDto` body
   - No OAuth callback handlers (mobile-first design)

---

### 3. Onboarding Tests (PASS) ✓
**Files:**
- `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/onboarding/onboarding.controller.spec.ts`
- `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/onboarding/onboarding.service.spec.ts`

**All 12 tests passed**

**Coverage:**
- Statements: 88.76%
- Branches: 80%
- Functions: 92.85%
- Lines: 90.36%

---

## Code Coverage Analysis

### Auth Module Coverage Summary
```
src/modules/auth                                     |   65.71 |    95.83 |   57.89 |   67.16 |
├── auth.service.ts                                  |   98.92 |    95.83 |     100 |    98.9 | ✓ EXCELLENT
├── auth.controller.ts                               |       0 |      100 |       0 |       0 | ✗ UNTESTED
├── Strategies (Auth)                                |      25 |        0 |       0 |   19.51 | ✗ POOR
│   ├── apple.strategy.ts                            |   54.54 |        0 |       0 |   44.44 |
│   ├── google-id-token-validator.strategy.ts        |   35.29 |        0 |       0 |   28.57 |
│   └── jwt.strategy.ts                              |       0 |        0 |       0 |       0 |
└── Guards                                           |       0 |        0 |       0 |       0 | ✗ UNTESTED
    └── jwt-auth.guard.ts                            |       0 |        0 |       0 |       0 |
```

### Gaps in Coverage

| Module | Line % | Issue | Impact |
|--------|--------|-------|--------|
| **jwt.strategy.ts** | 0% | Zero coverage | JWT strategy never tested |
| **jwt-auth.guard.ts** | 0% | Zero coverage | Auth guard never tested |
| **google-id-token-validator.strategy.ts** | 35.29% | Mostly untested | 64% of Google validation logic untested |
| **apple.strategy.ts** | 54.54% | Mostly untested | 45% of Apple strategy untested |
| **auth.controller.ts** | 0% | Zero coverage | Controller endpoints never tested |

**Critical Gap:** Auth middleware (guards/strategies) has near-zero coverage. These handle actual request validation - critical for security.

---

## Error Scenarios Testing

### Passing Error Tests (AuthService)
✓ Email already exists (ConflictException)
✓ Invalid password (UnauthorizedException)
✓ User not found (UnauthorizedException)
✓ Malformed refresh token (UnauthorizedException)
✓ Expired refresh token (UnauthorizedException)
✓ Token secret mismatch (UnauthorizedException)

### Missing Error Tests
✗ Controller-level error handling never tested
✗ Guard error scenarios not tested
✗ Invalid OAuth token validation not tested
✗ Malformed Google ID token handling not tested
✗ Invalid Apple ID token handling not tested

---

## Failing Tests - Full Error Output

```
[96msrc/modules/auth/auth.controller.spec.ts[0m:[93m7[0m:[93m28[0m - [91merror[0m[90m TS2307:
Cannot find module './strategies/google.strategy' or its corresponding type declarations.

    [7m7[0m import { GoogleUser } from './strategies/google.strategy';
    [7m [0m [91m                           ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~[0m
```

**Issue:** Import of non-existent `GoogleUser` type and `google.strategy` module

---

```
[96msrc/modules/auth/auth.controller.spec.ts[0m:[93m125[0m:[93m33[0m - [91merror[0m[90m TS2554:
Expected 1 arguments, but got 0.

    [7m125[0m       const result = controller.googleAuth();
    [7m   [0m [91m                                ~~~~~~~~~~[0m

      [96msrc/modules/auth/auth.controller.ts[0m:[93m39[0m:[93m20[0m
        [7m39[0m   async googleAuth(@Body() dto: GoogleAuthDto): Promise<AuthResponseDto> {
```

**Issue:** Method requires `GoogleAuthDto` parameter; test calls with zero arguments

---

```
[96msrc/modules/auth/auth.controller.spec.ts[0m:[93m142[0m:[93m19[0m - [91merror[0m[90m TS2341:
Property 'oauthLogin' is private and only accessible within class 'AuthService'.
```

**Issue:** Tests try to mock `oauthLogin`, but it's private. Cannot mock private methods in TypeScript.

---

```
[96msrc/modules/auth/auth.controller.spec.ts[0m:[93m144[0m:[93m39[0m - [91merror[0m[90m TS2339:
Property 'googleCallback' does not exist on type 'AuthController'.
```

**Issue:** Tests reference non-existent `googleCallback` method. Current controller is mobile-first (ID token POST endpoints, no OAuth callbacks).

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| AuthService tests execution | 3.6 seconds |
| All passing tests execution | 4.6 seconds |
| Test suite startup overhead | ~0.4 seconds |
| Average per-test time | ~0.12 seconds |

**Assessment:** Performance is excellent. No slow tests detected.

---

## Build Status

```bash
npm test
# Result: Test suite compilation FAILED due to auth.controller.spec.ts errors
# Build would FAIL if deployed
```

---

## Critical Issues Summary

### 🔴 BLOCKING ISSUE #1: Auth Controller Tests Broken
**Severity:** HIGH
**Scope:** All 9+ tests in auth.controller.spec.ts
**Cause:** Test file uses outdated API assumptions and references non-existent code

### 🟡 BLOCKING ISSUE #2: Missing Guards & Strategies Coverage
**Severity:** MEDIUM
**Scope:** `jwt.strategy.ts`, `jwt-auth.guard.ts`, OAuth validators
**Cause:** No tests written for authentication middleware (0% coverage)
**Risk:** JWT validation, token parsing, guard logic untested - direct security impact

### 🟡 BLOCKING ISSUE #3: Auth Controller Not Tested
**Severity:** MEDIUM
**Scope:** `auth.controller.ts`
**Cause:** Controller tests have compilation errors; cannot execute
**Risk:** HTTP endpoint parameter validation, error responses untested

---

## Recommendations (Priority Order)

### P0 - Fix Compilation Errors (MUST DO BEFORE PUSH)
1. **Remove/Rewrite auth.controller.spec.ts**
   - File references deprecated OAuth strategy pattern
   - Tests use invalid method signatures
   - Better to rewrite from scratch than patch
   - Estimated effort: 1-2 hours

2. **Steps:**
   - [ ] Delete current `auth.controller.spec.ts`
   - [ ] Create new controller tests matching current API:
     - `POST /auth/register` with RegisterDto
     - `POST /auth/login` with LoginDto
     - `POST /auth/google` with GoogleAuthDto
     - `POST /auth/apple` with AppleAuthDto
     - `POST /auth/refresh` with RefreshTokenDto
     - `POST /auth/logout` with @CurrentUser decorator
   - [ ] Add tests for error responses (409, 401 status codes)
   - [ ] Mock AuthService methods correctly

### P1 - Add Missing Test Coverage
3. **Add JWT Guard Tests**
   - Test valid JWT extraction and validation
   - Test missing/invalid Authorization header
   - Test expired tokens
   - File: Create `jwt-auth.guard.spec.ts`

4. **Add JWT Strategy Tests**
   - Test JWT payload validation
   - Test user ID extraction
   - File: Create `jwt.strategy.spec.ts`

5. **Add OAuth Validation Tests**
   - Test `google-id-token-validator.strategy.ts` with real Google tokens
   - Test `apple.strategy.ts` with Apple token validation
   - Mock external API calls appropriately

### P2 - Improve Coverage
6. **Target Coverage Goals:**
   - [ ] Auth strategies: 80%+ (currently ~35-55%)
   - [ ] Auth guards: 80%+ (currently 0%)
   - [ ] Auth controller: 80%+ (currently 0%)
   - **Overall auth module goal:** 85%+ (currently 65.71%)

---

## Next Steps

### Immediate (Before Next Push)
1. Fix compilation errors in auth.controller.spec.ts
   - Rewrite test file to match current controller API
   - Remove references to deprecated OAuth strategy pattern
   - Ensure all imports resolve

2. Run: `npm test -- --testPathPattern=auth`
   - Verify all tests compile and pass
   - Check coverage meets baseline (80%+)

### Short Term (Next 2 Days)
3. Add guard and strategy tests
4. Increase auth module coverage to 80%+
5. Verify security-critical paths (JWT validation) tested

### Validation Before Merge
- [ ] `npm test` passes (all suites)
- [ ] `npm run test:cov` shows 80%+ auth module coverage
- [ ] No TypeScript errors: `npm run build`
- [ ] All auth endpoints tested (happy path + errors)

---

## Success Criteria Met?

| Criterion | Status | Notes |
|-----------|--------|-------|
| All tests compile | ✗ FAIL | auth.controller.spec.ts has 9 TS errors |
| Unit tests run | ✓ PASS | AuthService: 26/26 |
| Service coverage 80%+ | ✓ PASS | AuthService: 98.92% |
| Controller coverage | ✗ FAIL | 0% (not tested) |
| Guards coverage | ✗ FAIL | 0% (not tested) |
| Strategies coverage | ✗ FAIL | 25-35% (mostly untested) |
| Error scenarios tested | △ PARTIAL | Service errors tested; controller/guard errors missing |
| Build ready for deploy | ✗ FAIL | Compilation errors prevent build |

---

## Files Requiring Action

| File | Issue | Action |
|------|-------|--------|
| `/src/modules/auth/auth.controller.spec.ts` | 9 TS errors | **REWRITE** - incompatible with current controller |
| `/src/modules/auth/jwt.strategy.spec.ts` | Missing | **CREATE** - 0% coverage |
| `/src/modules/auth/guards/jwt-auth.guard.spec.ts` | Missing | **CREATE** - 0% coverage |
| `/src/modules/auth/strategies/google-id-token-validator.strategy.spec.ts` | Missing | **CREATE** - 35% coverage |
| `/src/modules/auth/strategies/apple.strategy.spec.ts` | Missing | **CREATE** - 54% coverage |

---

## Summary

**Status:** TESTING FAILED - Compilation errors blocking controller tests

**Passing Tests:** 26/26 auth service tests + 12/12 onboarding tests = 38 total ✓

**Failing Tests:** 9 compilation errors in auth.controller.spec.ts ✗

**Critical Gap:** Zero coverage for auth middleware (guards/strategies) - direct security impact

**Effort to Fix:**
- Fix controller tests: 1-2 hours (rewrite to match mobile-first API)
- Add missing tests: 3-4 hours (guards, strategies, validators)
- **Total:** ~5-6 hours to reach 80%+ coverage + build ready

**Blockers:** Cannot merge until auth.controller.spec.ts rewritten and compiles successfully.

---

## Unresolved Questions

1. **Intent of deprecated OAuth callback pattern:** Test references `googleCallback` and `oauthLogin` methods that don't exist in current controller. Were these intentionally removed in favor of mobile-first ID token endpoints?

2. **Google/Apple token validation:** Should `google-id-token-validator.strategy.ts` and `apple.strategy.ts` be tested with real token samples or mocked validation? Current 35-54% coverage suggests some validation logic is untested.

3. **Onboarding linking security:** `auth.service.ts` has `linkOnboardingSession` tested only indirectly. Should explicit tests verify the session linking logic with real database interactions?

4. **JWT strategy usage:** `jwt.strategy.ts` has 0% coverage. Is this strategy actively used by the current application, or is it legacy code?
