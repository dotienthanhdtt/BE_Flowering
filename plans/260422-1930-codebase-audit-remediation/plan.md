# Codebase Audit — Remediation Plan

**Generated:** 2026-04-22
**Scope:** Full backend audit (4 parallel reviewers + adversarial red-team)
**Source reports:**
- `plans/reports/reviewer-2026-04-22-ai-scenario-vocabulary.md`
- reviewer-2026-04-22-auth-subscription (inline, Write denied)
- `plans/reports/reviewer-2026-04-22-infrastructure.md`
- reviewer-2026-04-22-feature-modules (inline, Write denied)
- `plans/reports/adversarial-2026-04-22-codebase-scan.md` (red-team verdicts)

**Aggregate:** 21 Critical claimed → **16 Accepted, 1 Rejected, 1 Deferred after red-team** · 53 Important · ~35 Minor

---

## P0 — Ship-Blockers (production impact, fix this week)

### 1. RevenueCat webhooks broken — subscriptions not activating
`src/app.module.ts:75` excludes `subscription/webhook`, but the actual route is `webhooks/revenuecat` (`revenuecat-webhook.controller.ts:23,43`). `SnakeToCamelCaseMiddleware` runs on webhook bodies, rewrites `app_user_id`, `period_type`, etc. to camelCase. Global `ValidationPipe` with `forbidNonWhitelisted` then **rejects every webhook with HTTP 400** (adversarial correction — it's a validation 400, not a silent drop). RevenueCat retries also 400. No subscription activations since this config landed.
**Fix:** change `.exclude('subscription/webhook')` → `.exclude({path:'webhooks/(.*)', method:RequestMethod.ALL})`. Better: invert the middleware to an allowlist of routes that need snake→camel.
**Verify:** replay a RevenueCat webhook fixture in staging → confirm 200 + row in `subscriptions`.

### 2. `@Throttle` decorator no-ops on AI public endpoints
`ai.controller.ts:96,114` uses `@Throttle({ default: {...} })` but `ai.module.ts:40-50` registers named throttlers `ai-short` / `ai-medium`. The key `'default'` matches nothing → per-route override silently drops, only the module-wide 20/min falls through (adversarial correction — it's reduced protection, not zero). Still means `/ai/chat/correct` and `/ai/translate` — both `@Public()` — cost 4× more than intended.
**Fix:** rename the decorator key to `'ai-short'`: `@Throttle({ 'ai-short': { limit: 5, ttl: 60_000 } })`. Apply to every `@Throttle` in the repo.

### 3. Five `ThrottlerModule.forRoot(...)` calls collide globally
Adversarial review found **5 calls** (ai / scenario-chat / onboarding / admin-content + one more), not 3. `forRoot` is global; last-resolved wins. Because `AdminContentModule` is imported last in `AppModule`, its `default: 5/min` likely shadows all other throttler configs.
**Fix:** hoist ONE `ThrottlerModule.forRoot([...merged throttlers...])` to `AppModule` with named throttlers. Feature modules use decorators only.

### 4. `UpdateUserDto` mass-assignment IDOR on `nativeLanguageId`
`src/modules/user/dto/update-user.dto.ts:19-22` + `user.service.ts:58` — `PATCH /users/me` accepts `nativeLanguageId` and pipes to `userRepo.update(userId, dto)`. Bypasses `Language.isNativeAvailable` check that `LanguageService.setNativeLanguage` enforces. `whitelist:true` lets it through because it IS a whitelisted field — it's the validation that's missing.
**Fix:** strip `nativeLanguageId` from `UpdateUserDto`; force clients to use `/users/me/native-language`. OR duplicate the `isNativeAvailable` check in `UserService.update`.

### 5. No `app.set('trust proxy', ...)` on Express adapter
`main.ts` never sets trust proxy. Railway proxies all traffic → `req.ip` = Railway proxy IP for every request → ALL `@Public()` endpoints (onboarding, `/ai/chat/correct`, `/ai/translate`) share ONE IP-keyed throttle bucket for all users globally.
**Fix:** `app.getHttpAdapter().getInstance().set('trust proxy', 1)` before throttler registration.

### 6. CORS `origin: true` fallback + `credentials: true`
`main.ts:41` — when `CORS_ALLOWED_ORIGINS` env is empty, `origin: true` reflects the caller's Origin header with credentials enabled. Full CSRF / token-exfil surface.
**Fix:** in `config/` joi schema, require `CORS_ALLOWED_ORIGINS` to be non-empty when `NODE_ENV=production`. Fail startup otherwise.

### 7. Sentry `sendDefaultPii: true` ships Authorization headers
`src/instrument.ts:24` — default-PII enabled. Every captured exception ships request IP, Authorization, Cookie, and body to Sentry. Any bearer-token-auth'd 5xx leaks the JWT.
**Fix:** `sendDefaultPii: false`. Add `beforeSend` that scrubs `authorization`, `cookie`, `password`, `otp`, `token`, `secret` keys.

### 8. `AllExceptionsFilter` leaks raw exception.message for non-HttpException
`src/common/filters/all-exceptions.filter.ts:37-39` — on non-HttpException, uses `exception.message` as the client-facing message. TypeORM `QueryFailedError` contains column/constraint names and sometimes the offending value.
**Fix:** when `status >= 500` or non-HttpException, set client message to `'Internal server error'`. Log the real message via Nest `Logger`. Replace `console.error` with `new Logger('ExceptionsFilter')`.

### 9. Opening-turn cost/DoS on `POST /scenarios/:id/chat` with `forceNew`
`scenario-chat.service.ts:127-132` fires an LLM call when `forceNew=true` and no `message`. No per-day cap on `forceNew`. Combined with reduced rate limit (#2) and shared IP bucket (#5), burns LLM tokens.
**Fix:** cap `forceNew` at N=3/day/user/scenario. Require either `conversationId` or non-empty `message`.

### 10. No rate limiting on any `AuthController` endpoint
`/auth/refresh` uses bcrypt.compare per request (DoS). `/auth/firebase` calls Firebase `verifyIdToken` unthrottled. `/auth/forgotPassword` has per-email DB cap but no per-IP cap.
**Fix:** wire `ThrottlerGuard` + `@Throttle` to `AuthController`. Tighter limits than AI (e.g. 10/min on refresh, 20/min on firebase).

---

## P1 — Security / Data Integrity (fix within 2 weeks)

### Auth & Session
- **Access-token lifetime 30 days** with no revocation (`auth.service.ts:28`). Shorten to ≤1h. Add `passwordChangedAt`/`tokenVersion` check in `JwtStrategy.validate`.
- **No refresh-token reuse detection** (`auth.service.ts:201-236`). On replay of revoked token, revoke entire family for that user.
- **Move `expiresAt` check BEFORE `bcrypt.compare`** in refresh flow to avoid gratuitous CPU on expired probes.
- **Device fingerprint claim in CLAUDE.md is aspirational** — `RefreshToken` has no UA/IP column, `generateTokens` never reads headers. Either implement or correct the docs.
- **RevenueCat `app_user_id` trusted as authoritative user id** — HMAC proves source, not ownership. Bind server-side at RevenueCat SDK login.
- **Idempotency row inserted BEFORE work** (`subscription.service.ts:58-77`). Transient failures mark event processed; retries skip. Insert AFTER state change or delete on failure.

### Data Race Conditions
- **`ProgressService.upsertProgress` lost updates** (`progress.service.ts:27-42`). Read-modify-write on counters. Use atomic SQL: `UPDATE user_progress SET exercises_completed = exercises_completed + :n, score_earned = score_earned + :s WHERE ...`.
- **`LanguageService.addUserLanguage` / `updateUserLanguage` races** (`language.service.ts:82-113, 131-138`). Wrap activation in transaction with `SELECT … FOR UPDATE`. Add partial unique index `user_languages(user_id) WHERE is_active=true`.
- **Scenario chat non-atomic writes** (`scenario-chat.service.ts:146-167`). User-message, assistant-message, and message-count are 3 writes. Wrap in `dataSource.transaction`.
- **`findOrCreate` race handler is dead code** if migration doesn't create partial unique index on `(user_id, scenario_id) WHERE completed!=true`. Verify migration `1778000200000` (or add).
- **`AdminContentService.generateDrafts` bulk save without transaction** (`admin-content.service.ts:100-105`). Partial-failure persists rows 1..N-1.

### Input Validation & Surface
- **`AdminContentService.updateContent` uses `as any`** (`admin-content.service.ts:149`). Defense-in-depth gone if global `whitelist` ever loosens. Use `Partial<Lesson>` or explicit field pick.
- **`CreateKolBundleDto.description` unlimited** — add `@MaxLength(2000)`.
- **`UpdateUserDto.avatarUrl`** uses `@IsString()` only — add `@IsUrl()` + `@MaxLength(500)`.
- **`SupabaseStorageService` has no MIME/size/ownership checks** (`supabase-storage.service.ts:21,58,66`). Move allowlist + size cap into the service. Enforce `filePath.startsWith(userId + '/')` on delete/list.
- **Prompt-injection via admin-content scenarios** (`scenario-chat.service.ts:110-113`). KOL bundle description interpolated into system prompt unsanitized. Validate admin-content max length + escape `{{` and backticks.

### Infrastructure
- **Helmet not installed.** No HSTS/CSP/X-Frame-Options. `app.use(helmet())` before `enableCors`.
- **Body-parser default 100kb.** Set `express.json({limit:'1mb'})` to bound payload DoS.
- **`PasswordReset.resetTokenHash` has no index** — add `@Index`.
- **`SnakeToCamelCaseMiddleware` applied to `'*'` with denylist.** Architectural landmine (root cause of P0 #1). Flip to allowlist.
- **`ResponseTransformInterceptor` mutates caller DTO + no StreamableFile/Buffer bypass** (`response-transform.interceptor.ts:14`). Clone before mutating; skip streams.

---

## P2 — Correctness & Quality (within 4 weeks)

### Correctness bugs
- **Scenario chat `completed` off-by-one** (`scenario-chat.service.ts:164`). User cannot reply to the AI's final turn. Rename to `isFinal` or loosen condition.
- **`currentTurn` drifts from `messageCount`** (`scenario-chat.service.ts:102` vs `:165`). Use `Math.floor(messageCount/2)+1`.
- **`IsValidLevelForLanguageConstraint` uses raw SQL column** (`is-valid-level-for-language.validator.ts:30`). Use entity property path.
- **Migration `1778000500000` doesn't normalize stale `proficiency_level` rows** before enum drop. Backfill + validate.
- **`LessonService.getLessons` paginates scenarios but groups by category** (`lesson.service.ts:49-55`). Documented response shape is inconsistent with pagination math.
- **`LessonService` ignores `query.language`** (`lesson.controller.ts:33`). Remove dead param.
- **`AdminContentService.listContent` broken pagination when `type` omitted** — three parallel queries concatenated.
- **`LanguageContextCacheService` is FIFO, not LRU, and per-process** (`language-context-cache.service.ts:55`). Incorrect eviction under load; stale reads across Railway replicas.

### Orphaned & Dead Code
- **`DeviceToken` entity is dead** — registered in `database.module.ts:38` but no module wires it. Delete or implement the notification module.
- **Entity barrel missing 3 exports** — `refresh-token.entity`, `scenario-category.entity`, `content-status.enum`. Consumers importing from `@/database/entities` get `undefined`.
- **`AiRateLimitGuard` file exists but is never imported anywhere** (`src/modules/ai/guards/ai-rate-limit.guard.ts`). Delete or wire.

### Perf
- **`JwtStrategy.validate` fires a DB query per request** (`jwt.strategy.ts:35-45`). 30-60s in-memory cache.
- **N+1 / over-select on lesson list** — add explicit `.select([...])` and `Promise.all` the subscription fetch.
- **`KolBundleService.list` inner fetch unbounded** (`kol-bundle.service.ts:96-107`). Per-page cap or aggregate subquery.
- **Unbounded LLM timeouts** across providers — wrap in `Promise.race` with 30s deadline.

### File Size (>200 LOC soft cap)
- `scenario-chat.service.ts` (390)
- `onboarding.service.ts` (356)
- `admin-content.service.ts` (242)
- `translation.service.ts` (221)
- `learning-agent.service.ts` (202)

---

## P3 — Minor / Cleanup

- Swagger coverage gap: `@ApiResponse` missing across `lesson`, `language`, `user`, `admin-content` controllers.
- `HttpLoggerMiddleware` logs full URL with query — redact `token|otp|code`.
- `app.controller.ts` health endpoint returns fake OK — add `SELECT 1`.
- `FirebaseAdminService.auth` throws raw `Error` when uninitialized — throw `ServiceUnavailableException`.
- `@Req() req: any` in `scenario-chat.controller.ts:38,53,63` — use `AuthenticatedRequest`.
- Multiple `as any` casts in `admin-content.service.ts`.
- `@Delete` on archive endpoint (`admin-content.controller.ts:62-68`) — rename to `@Patch(':id/archive')`.
- `case-converter.ts` has no cycle guard.
- Constant-time OTP compare (`auth.service.ts:289`).
- `console.log` in `instrument.ts` leaks `LANGFUSE_BASE_URL`.

---

## Rejected & Deferred

- **REJECTED — OAuth auto-link hijack (auth reviewer C4):** `firebase-token.strategy.ts:24` enforces `email_verified`. Attacker cannot mint a Firebase token for victim's email without controlling the email. The risk surface is only for attacks against the `login` route (now 410'd) or legacy accounts with password — confirm the password route is permanently off.
- **DEFERRED — `ProgressService.recordAttempt` client-supplied score:** no controller currently binds `isCorrect`/`pointsEarned` to `@Body()`. Future risk if a controller is added. Add a test that fails if any controller passes request-derived values to these params.

---

## Open Questions (verify before closing P0)

1. Is Railway running single-replica? Affects session-store (onboarding, review-session-store) and language-context-cache correctness.
2. Does migration `1778000200000` create the partial unique index on `ai_conversations(user_id, scenario_id) WHERE completed!=true`?
3. Does migration stack create unique index on `user_languages(user_id, language_id)`?
4. Is `RefreshToken` entity registered in `database.module.ts` global entities? (was not explicitly verified in audit)
5. Is `audio-files` Supabase bucket actually set to PRIVATE in dashboard (code asserts it in a comment)?
6. Is `WebhookEvent` entity registered in `database.module.ts` global entities array? (flagged by auth reviewer)

---

## Suggested Execution Order

**Week 1 (ship-blockers):** #1, #2, #3, #5, #6, #7, #10 — all `main.ts` / module config changes, low code churn.
**Week 2:** #4, #8, #9 — DTO changes + service-level validation.
**Week 3-4:** P1 auth hardening + data-race transactions (requires migrations).
**Week 5+:** P2 correctness bugs + file splits.
