# Brainstorm: Forgot Password Flow + Onboarding Scenarios
**Date:** 2026-02-28 | **Branch:** feat/auth-improvements-onboarding-linking

---

## Problem Statement

Two missing backend features per `requirement/new_api.md`:

**A. Forgot Password Flow** — 3 new public endpoints:
- `POST /auth/forgot-password` — send 6-digit OTP to email (rate: 3/hr)
- `POST /auth/verify-otp` — verify OTP → return short-lived reset token (max 5 attempts)
- `POST /auth/reset-password` — set new password using reset token (one-time use)

**B. Onboarding Complete Extension** — add `scenarios[]` (5 AI-generated cards) to `POST /onboarding/complete` response

---

## Current State (from scout)

- **Auth module**: register, login, Google, Apple, refresh, logout — no password reset
- **User entity**: no OTP or reset fields
- **Onboarding**: complete endpoint returns extracted profile only, no scenarios
- **Email**: no email service exists in codebase
- **Rate limiting**: no existing throttler setup in auth routes

---

## Agreed Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| OTP storage | New `PasswordReset` table | Clean separation, no User entity pollution, rate-limit tracking built-in |
| Email provider | Nodemailer + SMTP env vars | Compatible with Supabase/Resend SMTP; zero vendor lock-in |
| Rate limiting | DB-based counting | Natural use of PasswordReset table, email-scoped (not IP) |
| Scenarios storage | Generate & return only | YAGNI — client only needs them once at onboarding end |
| Scenarios LLM | Separate call after profile extraction | Reliable, debuggable, independent failure boundary |

---

## A. Forgot Password — Architecture

### New Entity: `PasswordReset`

```ts
// src/database/entities/password-reset.entity.ts
@Entity('password_resets')
class PasswordReset {
  id: UUID (PK)
  email: varchar(255) -- indexed
  otpHash: varchar(64)         -- SHA-256(6-digit OTP)
  resetTokenHash: varchar(64)  -- SHA-256(UUID) after OTP verified; null initially
  attempts: int (default 0)    -- OTP verification attempts
  expiresAt: timestamptz       -- OTP expiry: createdAt + 10min
  resetTokenExpiresAt: timestamptz | null  -- +15min from OTP verify
  used: boolean (default false)
  createdAt: timestamptz
}
```

> OTP hashed with SHA-256 (not bcrypt) — appropriate for short-lived, attempt-limited tokens

### New Module: `EmailModule`

```ts
// src/modules/email/email.service.ts
// Nodemailer transport via SMTP env vars:
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
sendOtp(to: string, otp: string): Promise<void>
```

Compatible with Supabase's Resend SMTP or any provider. Add to `.env.example`.

### Auth Service — 3 New Methods

**`forgotPassword(email)`**
1. Find user by email → `404` if not found
2. Count PasswordReset records for email in last hour → `429` if ≥ 3
3. Generate OTP: `crypto.randomInt(100000, 999999).toString()`
4. Insert PasswordReset (hash OTP, set expiresAt = now + 10min)
5. Send email via EmailService
6. Return masked email: `u***@example.com`

**`verifyOtp(email, otp)`**
1. Find latest non-expired, non-used PasswordReset for email → `400` if none
2. Increment attempts → `400` if now ≥ 5
3. Compare SHA-256(otp) === stored otpHash → `400` if mismatch
4. Generate reset token: `crypto.randomUUID()`
5. Store SHA-256(resetToken) in record, set resetTokenExpiresAt = now + 15min
6. Return raw `resetToken` to client

**`resetPassword(resetToken, newPassword)`**
1. Find PasswordReset where resetTokenHash = SHA-256(resetToken), used=false, resetTokenExpiresAt > now → `400`/`401`
2. Find user by email → hash new password (bcrypt 12 rounds)
3. Update user.passwordHash
4. Mark PasswordReset as used=true
5. Revoke all user's refresh tokens (security: force re-login on all devices)
6. Return null data

### Auth Controller — 3 New Endpoints

```ts
@Public()
POST /auth/forgot-password   → ForgotPasswordDto { email }
@Public()
POST /auth/verify-otp        → VerifyOtpDto { email, otp: string(6) }
@Public()
POST /auth/reset-password    → ResetPasswordDto { resetToken: UUID, newPassword: string(min 8) }
```

### New DTOs

```ts
ForgotPasswordDto  { @IsEmail() email }
VerifyOtpDto       { @IsEmail() email; @IsNumberString() @Length(6,6) otp }
ResetPasswordDto   { @IsUUID() resetToken; @MinLength(8) newPassword }
```

### Migration Required

Create `password_resets` table with all fields + index on `(email, created_at)`.

---

## B. Onboarding Scenarios — Architecture

### Extended `complete()` Flow

```
[existing] Extract profile from conversation → ExtractedProfile
[new]      Generate scenarios from profile   → ScenarioDto[5]
[new]      Return { ...profile, scenarios }
```

Both sequential (scenarios need profile data as input).

### Scenario Generation

```ts
// In OnboardingService
private async generateScenarios(profile: ExtractedProfile): Promise<ScenarioDto[]> {
  const prompt = buildScenariosPrompt(profile); // uses learningGoals + preferredTopics
  const raw = await this.llmService.complete(prompt);
  return this.parseScenarios(raw); // validates length = 5, fallback on parse error
}
```

**Prompt constraints:**
- Return exactly 5 JSON objects
- `icon`: from a pre-defined set of valid Lucide icon names (briefcase, coffee, globe, book, mic, etc.)
- `accentColor`: enum `primary | blue | green | lavender | rose`
- Generate unique `id` via `crypto.randomUUID()` (or LLM, but server-side is safer)

**Fallback**: if LLM returns malformed JSON or wrong count, throw `500` with clear message. No silent truncation.

### New DTO

```ts
class ScenarioDto {
  @IsUUID()     id: string;
  @IsString()   title: string;
  @IsString()   description: string;
  @IsString()   icon: string;          // Lucide icon name
  @IsEnum(['primary','blue','green','lavender','rose']) accentColor: string;
}
```

Extend `OnboardingCompleteResponseDto` to include `scenarios: ScenarioDto[]`.

---

## Files to Create / Modify

### New Files
- `src/database/entities/password-reset.entity.ts`
- `src/database/migrations/{timestamp}-create-password-resets-table.ts`
- `src/modules/email/email.service.ts`
- `src/modules/email/email.module.ts`
- `src/modules/auth/dto/forgot-password.dto.ts`
- `src/modules/auth/dto/verify-otp.dto.ts`
- `src/modules/auth/dto/reset-password.dto.ts`
- `src/modules/onboarding/dto/scenario.dto.ts`

### Modified Files
- `src/modules/auth/auth.service.ts` — 3 new methods
- `src/modules/auth/auth.controller.ts` — 3 new endpoints
- `src/modules/auth/auth.module.ts` — import EmailModule
- `src/modules/onboarding/onboarding.service.ts` — extend complete()
- `src/modules/onboarding/dto/onboarding-complete.dto.ts` — add scenarios to response
- `src/database/entities/index.ts` (or equivalent) — export new entity
- `docs/api/auth-api.md` — update with new endpoints
- `.env.example` — add SMTP_* vars

---

## Security Considerations

- SHA-256 for OTP/reset-token hashing (bcrypt overkill for 6-digit OTPs with rate limits)
- `crypto.randomInt()` for OTP (cryptographically secure, not Math.random())
- `crypto.randomUUID()` for reset token (Node.js built-in, UUID v4)
- Reset password → revoke all refresh tokens (prevent token reuse after compromise)
- Rate limit by email (not IP) to prevent targeting specific accounts
- Masked email in response (not full address exposure)

---

## Risks

| Risk | Mitigation |
|---|---|
| LLM generates wrong icon names | Pre-define allowed icon list in prompt; validate after parsing |
| LLM returns != 5 scenarios | Hard fail with 500 + clear log; no silent truncation |
| SMTP env not configured | EmailService validates at startup, throws meaningful error |
| PasswordReset table grows unbounded | Add cleanup job or short TTL index (future optimization) |
| OTP brute force | Strictly enforce 5-attempt limit at DB level |

---

## Success Criteria

- [ ] `POST /auth/forgot-password` returns 200 with masked email or 404/429
- [ ] `POST /auth/verify-otp` returns resetToken or 400/429
- [ ] `POST /auth/reset-password` resets password, invalidates all refresh tokens
- [ ] `POST /onboarding/complete` returns profile + exactly 5 scenarios
- [ ] All 3 auth endpoints are `@Public()` (no JWT required)
- [ ] Tests pass for all new methods
- [ ] `npm run build` succeeds

---

## Next Steps

Implement in this order:
1. EmailModule (foundation for auth)
2. PasswordReset entity + migration
3. Auth service methods + controller endpoints + DTOs
4. Onboarding scenarios extension
5. Tests
6. Docs update
