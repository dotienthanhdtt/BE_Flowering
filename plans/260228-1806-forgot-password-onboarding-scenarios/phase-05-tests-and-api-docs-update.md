---
status: completed
---

**Parent plan:** [plan.md](./plan.md)
**Requires:** [Phase 03](./phase-03-auth-forgot-password-otp-endpoints.md), [Phase 04](./phase-04-onboarding-complete-scenarios-generation.md)
**Docs:** `docs/api/auth-api.md`, `docs/api/onboarding-api.md`

---

# Phase 05: Tests + API Docs Update

**Priority:** P1 | **Status:** completed | **Est:** 1h

## Overview

Write unit tests for all new service methods and update API markdown docs for client consumption.

## Key Insights

- Existing test pattern: `auth.service.spec.ts` uses Jest with mocked repositories
- `npm test` runs Jest — check all tests pass before committing
- API docs must follow existing format in `docs/api/auth-api.md` and `docs/api/onboarding-api.md`
- Max 800 LOC per doc file (per project rules)

## Related Code Files

### Test files
- `src/modules/auth/auth.service.spec.ts` — add 3 new describe blocks (or new spec file if >200 lines)
- `src/modules/onboarding/onboarding.service.spec.ts` — add scenarios test cases

### Docs
- `docs/api/auth-api.md` — add forgot-password, verify-otp, reset-password endpoints
- `docs/api/onboarding-api.md` — update complete endpoint response schema

## Unit Tests

### Auth Service Tests (to add to `auth.service.spec.ts`)

**`forgotPassword()`**
```
✓ returns masked email when user found + OTP sent
✓ throws 404 when email not registered
✓ throws 429 when >= 3 requests in last hour
```

**`verifyOtp()`**
```
✓ returns resetToken on valid OTP
✓ throws 400 when no valid PasswordReset record found
✓ throws 400 when OTP is wrong
✓ throws 400 when attempts > 5
```

**`resetPassword()`**
```
✓ resets password + marks record used + revokes refresh tokens
✓ throws 400 when reset token not found / expired
✓ throws 401 when reset token already used
```

### Test Setup Pattern (follow existing spec style)
```ts
const mockPasswordResetRepo = {
  count: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn().mockImplementation((dto) => dto),
  save: jest.fn(),
};
const mockEmailService = {
  sendOtp: jest.fn().mockResolvedValue(undefined),
};
```

### Onboarding Service Tests (to add)

**`generateScenarios()` (via `complete()`)**
```
✓ returns exactly 5 scenarios with valid accentColor
✓ throws InternalServerErrorException when LLM returns non-array
✓ throws InternalServerErrorException when LLM returns wrong count
✓ assigns server-generated UUIDs (not LLM-generated)
✓ falls back accentColor to 'primary' when LLM returns invalid value
```

## API Docs Updates

### `docs/api/auth-api.md` — Append to existing

Add 3 new endpoint sections:

```markdown
## POST /auth/forgot-password

Send a 6-digit OTP to a registered email.

**Auth:** Public

**Request Body**
| Field | Type | Required |
|-------|------|----------|
| email | string | yes |

**Response 200**
{ "code": 1, "message": "Verification code sent", "data": { "email": "u***@example.com" } }

**Errors**
- 404: Email not found
- 429: Too many requests (3/hour limit)

---

## POST /auth/verify-otp

Verify the OTP and get a password reset token (valid 15 minutes).

**Auth:** Public

**Request Body**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| email | string | yes | |
| otp | string | yes | 6 digits |

**Response 200**
{ "code": 1, "message": "OTP verified", "data": { "resetToken": "uuid" } }

**Errors**
- 400: Invalid or expired OTP; Too many attempts (max 5)

---

## POST /auth/reset-password

Set new password using the reset token from /auth/verify-otp.

**Auth:** Public

**Request Body**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| resetToken | UUID | yes | From verify-otp |
| newPassword | string | yes | Min 8 chars |

**Response 200**
{ "code": 1, "message": "Password reset successfully", "data": null }

**Side effects:** Revokes all active refresh tokens (forces re-login on all devices)

**Errors**
- 400: Invalid or expired reset token
- 401: Token already used
```

### `docs/api/onboarding-api.md` — Update complete endpoint

Update response schema to include `scenarios[]`:

```markdown
**scenarios[] item fields:**
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Server-generated scenario identifier |
| title | string | Short scenario title |
| description | string | 1-2 sentence description |
| icon | string | Lucide icon name |
| accentColor | primary\|blue\|green\|lavender\|rose | Card accent color token |

Always returns exactly 5 scenarios. AI-generated from learningGoals + preferredTopics.
```

## Implementation Steps

1. Add auth service test cases for `forgotPassword`, `verifyOtp`, `resetPassword`
2. Add onboarding service test cases for `generateScenarios` parsing
3. Run `npm test` — fix any failures before proceeding
4. Append 3 new endpoint docs to `docs/api/auth-api.md`
5. Update `docs/api/onboarding-api.md` complete endpoint response schema

## Todo List

- [ ] Add auth service unit tests (3 methods, ~9 cases)
- [ ] Add onboarding service unit tests for parseScenarios (~5 cases)
- [ ] `npm test` passes with no failures
- [ ] Update `docs/api/auth-api.md`
- [ ] Update `docs/api/onboarding-api.md`

## Success Criteria

- All new test cases pass
- No regression in existing tests
- API docs clearly document request/response/errors for all 5 changed endpoints
- `npm test` exits 0
