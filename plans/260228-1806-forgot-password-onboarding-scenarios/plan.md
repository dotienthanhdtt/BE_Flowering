---
title: "Forgot Password Flow + Onboarding Scenarios"
description: "Add forgot-password OTP flow (3 new auth endpoints) and extend onboarding/complete with 5 AI-generated scenario cards"
status: completed
priority: P1
effort: 4.5h
branch: feat/auth-improvements-onboarding-linking
tags: [auth, onboarding, email, otp, ai, typeorm]
created: 2026-02-28
---

# Plan: Forgot Password Flow + Onboarding Scenarios

**Brainstorm:** `plans/reports/brainstorm-260228-1756-forgot-password-onboarding-scenarios.md`
**Branch:** `feat/auth-improvements-onboarding-linking`

## Phases

| # | Phase | Status | Est. |
|---|---|---|---|
| 01 | [Email Module + Config](./phase-01-email-module-smtp-config.md) | ✅ done | 0.5h |
| 02 | [PasswordReset Entity + Migration](./phase-02-password-reset-entity-migration.md) | ✅ done | 0.5h |
| 03 | [Auth Forgot Password Flow](./phase-03-auth-forgot-password-otp-endpoints.md) | ✅ done | 1.5h |
| 04 | [Onboarding Scenarios Extension](./phase-04-onboarding-complete-scenarios-generation.md) | ✅ done | 1h |
| 05 | [Tests + Docs](./phase-05-tests-and-api-docs-update.md) | ✅ done | 1h |

## Key Dependencies
- Phase 01 must complete before Phase 03 (EmailModule needed by AuthModule)
- Phase 02 must complete before Phase 03 (PasswordReset entity needed by AuthService)
- Phase 03 and Phase 04 can run in parallel
- Phase 05 depends on 03 and 04

## New Files
- `src/modules/email/email.service.ts`
- `src/modules/email/email.module.ts`
- `src/database/entities/password-reset.entity.ts`
- `src/database/migrations/{ts}-create-password-resets-table.ts`
- `src/modules/auth/dto/forgot-password.dto.ts`
- `src/modules/auth/dto/verify-otp.dto.ts`
- `src/modules/auth/dto/reset-password.dto.ts`
- `src/modules/onboarding/dto/onboarding-scenario.dto.ts`
- `src/modules/ai/prompts/onboarding-scenarios-prompt.md`

## Modified Files
- `src/config/app-configuration.ts` — add smtp config
- `src/config/environment-validation-schema.ts` — add SMTP_* validation
- `src/modules/auth/auth.service.ts` — 3 new methods
- `src/modules/auth/auth.controller.ts` — 3 new endpoints
- `src/modules/auth/auth.module.ts` — import EmailModule + PasswordReset entity
- `src/modules/auth/dto/index.ts` — export new DTOs
- `src/modules/onboarding/onboarding.service.ts` — extend complete()
- `src/modules/onboarding/dto/index.ts` — export ScenarioDto
- `.env.example` — add SMTP_* vars
- `docs/api/auth-api.md` — add 3 new endpoints
- `docs/api/onboarding-api.md` — update complete response

## Validation Log

### Session 1 — 2026-02-28
**Trigger:** Initial plan creation validation
**Questions asked:** 4

#### Questions & Answers

1. **[Risk]** If EmailService.sendOtp() throws an SMTP error AFTER the PasswordReset record is already saved in DB — what should happen?
   - Options: Delete record + throw 500 | Keep record + throw 500 | Swallow error, return 200
   - **Answer:** Swallow error, return 200
   - **Rationale:** Fire-and-forget email; never expose SMTP errors to client. Wrap `sendOtp()` in try/catch in `forgotPassword()`, log warning on failure, always return 200 with masked email.

2. **[Architecture]** The reset-password flow has a logic gap: querying WHERE resetTokenHash=? AND used=false AND expiresAt>now, then checking if used=true throws 401 — but used=true records are excluded by the query, making the 401 branch unreachable.
   - Options: Query by hash only, check used/expiry separately | Simplify to single 400
   - **Answer:** Query by hash only, then check used/expiry separately
   - **Rationale:** Find `PasswordReset` by `resetTokenHash` alone. Then: if not found → 400. If `used=true` → 401. If `resetTokenExpiresAt < now` → 400. Proper separation of error cases per spec.

3. **[Assumption]** Google/Apple OAuth users have passwordHash=null. If they call /auth/forgot-password, the flow succeeds and effectively enables password auth for them. Intended?
   - Options: Yes, allow it | Block with 400
   - **Answer:** Yes, allow it
   - **Rationale:** Consistent with auto-linking behavior. No change needed in implementation.

4. **[Risk]** If the scenarios LLM call fails in onboarding/complete() — profile extraction already succeeded. What should happen?
   - Options: Throw 500 | Return profile + empty scenarios [] | Return profile + 5 hardcoded fallbacks
   - **Answer:** Return profile + empty scenarios []
   - **Rationale:** Partial success is acceptable. Profile data is valuable; scenarios are additive. Catch error in `generateScenarios()`, log warning, return `[]`. Client handles empty array gracefully.

#### Confirmed Decisions
- Email failure: fire-and-forget (try/catch sendOtp, always return 200)
- reset-password: query by hash only, check used/expiry in separate conditions
- OAuth users: allowed to use forgot-password flow (no guard needed)
- Scenarios failure: return `[]` not 500

#### Action Items
- [ ] Phase 03: wrap `sendOtp()` in try/catch in `forgotPassword()`, log warning, never rethrow
- [ ] Phase 03: fix `resetPassword()` — query by `resetTokenHash` only, then check `used` and `expiresAt` separately
- [ ] Phase 04: change `parseScenarios()` catch block from `throw InternalServerErrorException` to `return []`

#### Impact on Phases
- Phase 03: `forgotPassword()` — wrap email send in try/catch. `resetPassword()` — rewrite query logic (find by hash only, check fields separately)
- Phase 04: `parseScenarios()` — on error, log + return `[]` instead of throwing 500
