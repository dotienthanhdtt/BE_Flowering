# Adversarial Red-Team Review — 2026-04-22

Ground truth: codebase @ dev branch. All citations verified file:line.

## Verdicts on Top Critical Claims

### CLAIM #1 — RevenueCat webhook middleware mutation — **ACCEPT (CRITICAL, confirmed)**

- `app.module.ts:75` excludes `subscription/webhook`.
- Real webhook route is `POST /webhooks/revenuecat` (`revenuecat-webhook.controller.ts:23` + `:43`).
- `SubscriptionController` is actually `@Controller('subscriptions')` (`subscription.controller.ts:15`) — plural. There is no `subscription/webhook` route at all; the exclude pattern is dead.
- No `setGlobalPrefix` in `main.ts` (`grep` returned 0 matches) — confirms the exclude string is the full path.
- `SnakeToCamelCaseMiddleware` (`snake-to-camel-case.middleware.ts:11-16`) mutates `req.body` recursively via `toCamelCase`.
- `RevenueCatWebhookDto` fields are snake_case (`app_user_id`, `product_id`, `expiration_at_ms`, `purchased_at_ms`, `api_version`, `original_app_user_id`, `entitlement_id` — `revenuecat-webhook.dto.ts:20-73`). After middleware, these become `appUserId` etc. — the DTO expects the snake_case names.
- `main.ts:25` applies `forbidNonWhitelisted: true`. Middleware runs BEFORE `ValidationPipe`; validation will reject the body with 400 because every required snake_case property is now missing. Request 400s BEFORE reaching the controller, so `webhookEventRepo.insert(...)` at `subscription.service.ts:58-70` is never called — no idempotency row written — meaning RevenueCat's retries also 400.
- Net impact: **100% of RevenueCat webhooks fail validation in production. Subscriptions are never activated via webhook.** (The reviewer's chain — "idempotency row saved, event silently dropped" — is slightly wrong; validation rejects earlier. Either way, subscriptions are broken.)

**Fix:** change exclude to `{ path: 'webhooks/revenuecat', method: RequestMethod.ALL }` OR apply middleware narrowly via `.forRoutes(controllerList)` instead of `'*'`.

---

### CLAIM #2 — AI endpoints throttler-name mismatch — **ACCEPT (HIGH)**

- `ai.controller.ts:96` + `:114` use `@Throttle({ default: { limit: 5, ttl: 60_000 } })`.
- `ai.module.ts:39-50` configures only `'ai-short'` + `'ai-medium'`, no `'default'`.
- `node_modules/@nestjs/throttler/dist/throttler.guard.js:67-83` iterates `this.throttlers` and does `reflector.getAllAndOverride(THROTTLER_LIMIT + namedThrottler.name, ...)` — it looks up overrides keyed by each configured throttler's name. The `default` key on the decorator matches no configured throttler, so the override is silently ignored and the `ai-short` (20/min) + `ai-medium` (100/hr) defaults apply.
- Not "zero rate limit" as asserted — the `@Throttle` decorator silently no-ops, but the module-wide default (20/min + 100/hr) still applies. So `/ai/chat/correct` and `/ai/translate` are not unlimited, but they are NOT the stricter 5/min the author intended.
- Note tracking is per-IP (default tracker). Combined with `@Public()` on these endpoints, an abuser gets 20/min + 100/hr per IP for unauthenticated LLM calls — still burnable at scale, but not "unlimited."

**Fix:** either name the throttler (`@Throttle({ 'ai-short': { limit: 5, ttl: 60_000 } })`) or use a consistently-named default throttler.

---

### CLAIM #3 — Multiple `ThrottlerModule.forRoot` collide — **ACCEPT (HIGH, broader than asserted)**

- `node_modules/@nestjs/throttler/dist/throttler.module.js:60-63`: `ThrottlerModule` is `@Global()`, last import wins.
- Five separate `forRoot` calls found:
  - `ai.module.ts:39` — `ai-short`, `ai-medium`
  - `scenario-chat.module.ts:29` — `ai-short`, `ai-medium`
  - `scenarios.module.ts:25` — `default` (5/min)
  - `onboarding.module.ts:15` — `default` (30/hr)
  - `admin-content.module.ts:17` — `default` (5/min)
- Each re-registers the `THROTTLER_OPTIONS` provider token globally; NestJS resolves multiple providers with the same token as "last one wins" in module-registration order. Effective config is non-deterministic to a reader — depends on `AppModule` import order (`app.module.ts:42-53` → Ai, Onboarding, ScenarioChat, Scenarios, AdminContent — last registered would be `admin-content.module`'s `default: 5/min`).
- Consequence: `OnboardingController`'s intended 30/hr limit is silently replaced; `ai-short/ai-medium` named throttlers on scenario-chat and AI paths disappear if `admin-content` wins. Because AdminContent is last in `app.module.ts:53`, the final global throttler config is almost certainly **only** `default: 5/min` — meaning every `@Throttle({ ai-short: ... })` and `@Throttle({ ai-medium: ... })` decorator on scenario-chat silently no-ops the same way Claim #2 describes.

**Fix:** consolidate into one `ThrottlerModule.forRoot([...])` call in `AppModule` with all named throttlers; remove from feature modules.

---

### CLAIM #4 — `UpdateUserDto` mass-assignment on `nativeLanguageId` — **ACCEPT (HIGH)**

- `update-user.dto.ts:19-22` exposes `nativeLanguageId` with only `@IsUUID()` — no validation that the language is marked `isNativeAvailable`.
- `user.service.ts:58` does `this.userRepo.update(userId, dto)` — passes through unchanged.
- `language.service.ts:61-68` (the intended legitimate path) checks `isNativeAvailable` and throws `BadRequestException` if not. PATCH `/users/me` bypasses that check entirely.
- `main.ts:25` `whitelist + forbidNonWhitelisted` doesn't help — `nativeLanguageId` IS whitelisted in the DTO.
- Exploit: user PATCHes any UUID of a language where `isNativeAvailable=false` (or a random UUID that doesn't exist). Random UUID would fail FK constraint but a valid learning-only language would succeed.

**Fix:** either remove `nativeLanguageId` from `UpdateUserDto` (force clients to call `setNativeLanguage`) or replicate the `isNativeAvailable` validation in `UserService.update`.

---

### CLAIM #5 — `ProgressService.recordAttempt` trusts client-supplied `isCorrect`/`pointsEarned` — **DEFER (latent)**

- `progress.service.ts:44-64` does take those as params.
- `grep recordAttempt` across `src/` — only one hit: the definition itself. **No controller wired.** Progress module has no controller file (`ls modules/progress/` → `progress.module.ts`, `progress.service.ts` only).
- Latent bug: first controller author who wires `@Body() dto` with those fields creates the vulnerability. Add a comment + server-side exercise lookup now to prevent it.

---

### CLAIM #6 — CORS wildcard fallback — **ACCEPT (HIGH)**

- `main.ts:39-45`: when `corsOrigins` is empty string → `origin: true` reflects caller's Origin with `credentials: true`. That's functionally open CORS for any site willing to set a cookie.
- `environment-validation-schema.ts:7-10`: `CORS_ALLOWED_ORIGINS` is `.allow('').optional()` — no failure if unset in prod.
- No fail-closed guard for production.
- Real-world impact is limited because JWT is in `Authorization: Bearer` header (not cookies), and browsers do NOT send custom `Authorization` headers cross-origin without explicit code on the attacker page. But: `credentials: true` + reflected origin + any future cookie-auth endpoint = exfiltration; Swagger UI (enabled when `NODE_ENV !== 'production'`) becomes open.

**Fix:** if `nodeEnv === 'production'` and `corsOrigins` is empty, throw on startup. Never allow `origin: true` with credentials in prod.

---

### CLAIM #7 — Sentry `sendDefaultPii: true` — **ACCEPT (MEDIUM)**

- `instrument.ts:24` — confirmed literal.
- Sentry's `sendDefaultPii` sends request headers (incl. `Authorization`, `Cookie`), request body, user IP, and username. For a service that logs Bearer JWTs in headers, this leaks full session tokens to Sentry.

**Fix:** set `sendDefaultPii: false` and add explicit `beforeSend` to scrub selectively. Or keep true but add Sentry `integrations: [Sentry.requestDataIntegration({ include: {...} })]` with header allowlist excluding Authorization.

---

### CLAIM #8 — OAuth auto-linking hijack — **REJECT**

- `firebase-token.strategy.ts:24-26` hard-requires `decoded.email_verified` before the oauthLogin path runs.
- Firebase Admin SDK verifies the token signature + issuer. An attacker can't mint a token with `email_verified=true` for a victim's address without compromising Google/Apple/Firebase.
- Auto-link at `auth.service.ts:163-176` is therefore gated by cryptographic verification of email ownership. Not a hijack vector.
- Caveat: **if** in future someone adds a provider where `email_verified` can be self-asserted (e.g., a custom OIDC), this becomes exploitable. Add a defense-in-depth check: require `passwordHash` to be null OR send a confirmation email before linking.

---

## Adjacent Red-Team Findings

### a. Trust proxy — **HIGH**
- `grep -rn "trust proxy"` across `src/` → **0 matches**.
- Railway fronts the app with a proxy. Without `app.set('trust proxy', ...)`, `req.ip` = proxy IP for every request, and `X-Forwarded-For` is ignored.
- ThrottlerGuard's IP tracker (the default on `@Public()` endpoints like `/ai/chat/correct`, `/ai/translate`, `/webhooks/revenuecat`, `/onboarding/*`) will bucket every request to the same key → one slow user exhausts the limit for everyone behind that Railway edge.
- Also pollutes request logs, Sentry user-IP, and future IP-based bans.
- **Fix:** in `main.ts`, after `NestFactory.create`, call `app.set('trust proxy', 1)` (or `true`), then ensure throttler tracker uses `req.ips[0]` or `X-Forwarded-For`.

### b. Swagger in non-production — **LOW**
- `main.ts:48` gates Swagger by `nodeEnv !== 'production'`. Correct, but combined with open CORS fallback means any staging/dev deploy with missing `CORS_ALLOWED_ORIGINS` exposes Swagger + open CORS. Acceptable if non-prod deploys are private.

### c. Entity registration — **PASS**
- `database.module.ts:27-50` registers all 22 entities (Vocabulary, VocabularyInjectionEvent, WebhookEvent, DeviceToken, ScenarioCategory, RefreshToken included).
- Spot checked feature modules; `vocabulary.module.ts:15`, `subscription.service.ts` constructor all match. CLAUDE.md rule satisfied.

### d. JWT secret rotation — **UNVERIFIABLE**
- `JWT_SECRET` is read once via ConfigService; no rotation support visible. Restart invalidates nothing directly (symmetric HS256 with single secret — same secret validates existing tokens). Rotating the secret invalidates **all** live tokens. No JWKS / kid support. Acceptable given 30-day access + DB-backed refresh tokens.

### e. Migrations on startup — **PASS**
- `database.module.ts:69` and `typeorm-data-source.ts:14` both `synchronize: false`. No `migrationsRun` flag. Migrations run only via `npm run migration:run` manually. No startup race.

### f. `eval` / `Function` / `exec` — **PASS**
- `grep -rnE "eval\(|new Function\(|child_process.*exec\b"` across `src/` → 0 hits. Clean.

### g. `transform: true` + `enableImplicitConversion: true` + snake-to-camel middleware — **MEDIUM**
- `main.ts:22-29`: `enableImplicitConversion: true` coerces string → number aggressively. Combined with the snake-to-camel middleware that rewrites body keys, future DTOs accepting query params / nested bodies can silently drop intended types. Flag for future DTO reviews.

### h. `tracesSampleRate: 1.0` in Sentry — **LOW**
- `instrument.ts:23` samples 100% of traces to Sentry. Combined with `sendDefaultPii: true` and Langfuse duplicating LLM payloads, this means full request bodies (incl. LLM prompts which may include user data) flow to both Sentry and Langfuse. Not a bug, but a privacy + cost concern worth the team's attention.

### i. Webhook body validation `@ValidateNested` depth — **PASS**
- `revenuecat-webhook.dto.ts:71-73` declares nested type with `@Type(() => RevenueCatEventDto)` + `@ValidateNested()`. Correct.

### j. `SnakeToCamelCaseMiddleware` scope is too wide — **HIGH (root cause of Claim #1)**
- `app.module.ts:73-76` applies the middleware to **every route** with a single dead-string exclude. Any future external integration that must receive raw snake_case (Stripe, Twilio, GitHub webhooks, etc.) will be silently corrupted. The architectural smell is "global body mutation" — an allowlist model (apply only to internal controllers) is safer than a denylist.

---

## Summary Table

| # | Claim | Verdict | Severity |
|---|-------|---------|----------|
| 1 | RevenueCat webhook broken by middleware | ACCEPT | CRITICAL |
| 2 | AI throttler name mismatch silent | ACCEPT | HIGH |
| 3 | Multiple ThrottlerModule.forRoot collide | ACCEPT | HIGH |
| 4 | UpdateUserDto nativeLanguageId IDOR | ACCEPT | HIGH |
| 5 | ProgressService.recordAttempt tamper | DEFER | LOW (latent) |
| 6 | CORS wildcard fallback in prod | ACCEPT | HIGH |
| 7 | Sentry sendDefaultPii leaks auth | ACCEPT | MEDIUM |
| 8 | OAuth auto-link hijack | REJECT | — |
| a | No trust proxy on Railway | NEW | HIGH |
| j | Global body-mutation middleware | NEW | HIGH (architectural) |

## Unresolved Questions

- Does Railway deploy set `CORS_ALLOWED_ORIGINS` and `JWT_SECRET` correctly in prod? (Cannot verify from repo alone.)
- Is RevenueCat currently live in prod? If so, zero subscriptions have activated via webhook since `SnakeToCamelCaseMiddleware` was introduced — worth a DB check on `webhook_events` row count vs RevenueCat dashboard event count.
- Is Sentry's DSN set in prod? If yes, #7 is actively leaking; if no, dormant.

**Status:** DONE
