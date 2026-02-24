# Security Audit Report - be_flowering NestJS Backend

**Date:** 2026-02-23
**Auditor:** Security Auditor Agent
**Scope:** Full codebase review of `/Users/tienthanh/Documents/new_flowering/be_flowering`
**Framework:** NestJS 11 + TypeORM + Supabase/PostgreSQL

---

## Executive Summary

The codebase demonstrates a reasonable security baseline with global JWT authentication, parameterized TypeORM queries, input validation via class-validator, and RLS policies. However, several findings require immediate attention, particularly a **hardcoded fallback JWT secret**, an **excessively long access token expiry (30 days)**, a **performance-destructive refresh token lookup** that loads all non-revoked tokens, **missing IDOR protection on conversation messages**, and a **webhook bypass when the secret is unconfigured**. Additionally, 45 npm dependency vulnerabilities were detected (1 critical).

**Risk Summary:**
| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 5 |
| Medium | 8 |
| Low | 5 |
| Info | 4 |

---

## Vulnerability Inventory

### CRITICAL-01: Hardcoded Fallback JWT Secret

- **Severity:** Critical
- **CWE:** CWE-798 (Use of Hard-coded Credentials)
- **OWASP:** A07:2021 - Identification and Authentication Failures
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/auth/strategies/jwt.strategy.ts:28`
- **Code:**
  ```typescript
  secretOrKey: secret || 'fallback-secret',
  ```
- **Description:** If `JWT_SECRET` env var is missing or empty, the JWT strategy falls back to a predictable string `'fallback-secret'`. An attacker who discovers this (it's in source code) can forge arbitrary JWT tokens and impersonate any user. The env validation schema requires `JWT_SECRET` (Joi `.required()`) but the config loader in `app-configuration.ts:58` defaults to empty string: `secret: process.env.JWT_SECRET || ''`, which passes Joi validation as a truthy string but creates a near-empty secret.
- **Exploitability:** Trivial -- forge JWTs with `jwt.sign({sub: targetUserId, email: any}, 'fallback-secret')`.
- **Business Impact:** Complete authentication bypass; full account takeover for any user.
- **Recommendation:**
  1. Remove the fallback entirely; throw an error if secret is not set:
     ```typescript
     if (!secret) throw new Error('JWT_SECRET must be configured');
     secretOrKey: secret,
     ```
  2. In `app-configuration.ts`, do NOT provide a fallback empty string for `jwt.secret`.

---

### CRITICAL-02: Dependency Vulnerability - fast-xml-parser DoS / Entity Expansion

- **Severity:** Critical
- **CWE:** CWE-776 (Improper Restriction of Recursive Entity References in DTDs)
- **Location:** `node_modules/fast-xml-parser` (via `@google-cloud/storage`)
- **Description:** `fast-xml-parser` 4.1.3-5.3.5 has two vulnerabilities: (1) DoS via uncontrolled entity expansion in DOCTYPE (GHSA-jmr7-xgp7-cmfj) and (2) entity encoding bypass via regex injection (GHSA-m7jm-9gc2-mpf2). Exploitable if XML parsing is used on untrusted input.
- **Recommendation:** Run `npm audit fix` to upgrade `fast-xml-parser`. If auto-fix is unavailable, pin `@google-cloud/storage` to a version that uses a patched `fast-xml-parser`.

---

### HIGH-01: Excessive Access Token Lifetime (30 Days)

- **Severity:** High
- **CWE:** CWE-613 (Insufficient Session Expiration)
- **OWASP:** A07:2021 - Identification and Authentication Failures
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/auth/auth.service.ts:14`
- **Code:**
  ```typescript
  const ACCESS_TOKEN_EXPIRY = '30d';
  ```
- **Description:** Access tokens are valid for 30 days. If a token is leaked (XSS, logging, network interception, device theft), the attacker has a 30-day window. Refresh tokens exist but the access token alone grants full access. Industry standard is 15-60 minutes for access tokens.
- **Business Impact:** Prolonged unauthorized access if token is compromised.
- **Recommendation:** Reduce `ACCESS_TOKEN_EXPIRY` to `'15m'` or `'1h'`. Use the existing refresh token flow for session continuity.

---

### HIGH-02: Refresh Token Full-Table Scan with bcrypt Compare

- **Severity:** High
- **CWE:** CWE-400 (Uncontrolled Resource Consumption), CWE-208 (Observable Timing Discrepancy)
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/auth/auth.service.ts:140-153`
- **Code:**
  ```typescript
  const storedTokens = await this.refreshTokenRepository.find({
    where: { revoked: false },
    relations: ['user'],
  });
  for (const stored of storedTokens) {
    const isMatch = await bcrypt.compare(refreshToken, stored.tokenHash);
    ...
  }
  ```
- **Description:** Every refresh token request loads ALL non-revoked refresh tokens from the database and iterates with bcrypt comparison. This is O(n) in bcrypt operations (each ~250ms). With 10,000 active users, a single refresh request could take 40+ minutes. This also creates a DoS vector: attackers can send many refresh requests to exhaust CPU.
- **Business Impact:** Application-level DoS; extreme latency on token refresh.
- **Recommendation:** Store a token prefix (first 8 chars of the hex token) as an indexed plaintext column, then query by prefix first, then bcrypt-compare only the matching row(s):
  ```typescript
  const prefix = refreshToken.substring(0, 8);
  const candidates = await this.refreshTokenRepository.find({
    where: { tokenPrefix: prefix, revoked: false },
    relations: ['user'],
  });
  ```

---

### HIGH-03: Missing IDOR Protection on Conversation Messages Endpoint

- **Severity:** High
- **CWE:** CWE-639 (Authorization Bypass Through User-Controlled Key)
- **OWASP:** A01:2021 - Broken Access Control
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/ai/ai.controller.ts:163-170`
- **Code:**
  ```typescript
  @Get('conversations/:id/messages')
  async getConversationMessages(
    @Param('id', ParseUUIDPipe) conversationId: string,
  ): Promise<{ messages: unknown[] }> {
    const messages = await this.learningAgent.getConversationMessages(conversationId);
    return { messages };
  }
  ```
- **Description:** This endpoint takes a `conversationId` from the URL but does NOT verify that the authenticated user owns the conversation. Any authenticated user can read any other user's AI conversation messages by guessing/enumerating conversation UUIDs (which are v4 UUIDs, so enumeration is hard but not impossible via information disclosure). RLS policies exist at the Supabase level but TypeORM uses a service-role connection that bypasses RLS.
- **Business Impact:** Unauthorized access to other users' private AI conversations, potential data breach.
- **Recommendation:** Add ownership check:
  ```typescript
  async getConversationMessages(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) conversationId: string,
  ) {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId, userId: user.id }
    });
    if (!conversation) throw new NotFoundException();
    ...
  }
  ```

---

### HIGH-04: CORS Wildcard Fallback

- **Severity:** High
- **CWE:** CWE-942 (Permissive Cross-domain Policy)
- **OWASP:** A05:2021 - Security Misconfiguration
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/main.ts:36`
- **Code:**
  ```typescript
  origin: corsOrigins ? corsOrigins.split(',').map((o) => o.trim()) : true,
  ```
- **Description:** When `CORS_ALLOWED_ORIGINS` is empty (which it can be -- the Joi schema allows `''`), CORS origin is set to `true`, meaning ALL origins are allowed. Combined with `credentials: true`, this allows any website to make authenticated cross-origin requests, enabling CSRF-like attacks via cross-origin fetch with cookies/tokens.
- **Business Impact:** Cross-site request forgery; credential theft from any malicious website.
- **Recommendation:** Never fall back to `true`. Require explicit origins or restrict to known defaults:
  ```typescript
  origin: corsOrigins
    ? corsOrigins.split(',').map((o) => o.trim())
    : ['http://localhost:3000'],
  ```

---

### HIGH-05: RevenueCat Webhook Auth Bypass When Secret Not Configured

- **Severity:** High
- **CWE:** CWE-306 (Missing Authentication for Critical Function)
- **OWASP:** A07:2021 - Identification and Authentication Failures
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/subscription/webhooks/revenuecat-webhook.controller.ts:41`
- **Code:**
  ```typescript
  if (expectedSecret && !this.verifyAuth(authHeader, expectedSecret)) {
  ```
- **Description:** When `REVENUECAT_WEBHOOK_SECRET` is not configured (empty/undefined, allowed by Joi schema as optional), the webhook accepts ALL requests without authentication. An attacker can send forged webhook payloads to manipulate any user's subscription status (grant premium access, cancel subscriptions).
- **Business Impact:** Revenue loss via fraudulent premium upgrades; subscription manipulation.
- **Recommendation:** Either require the webhook secret in Joi validation, or reject requests when no secret is configured:
  ```typescript
  if (!expectedSecret) {
    throw new InternalServerErrorException('Webhook secret not configured');
  }
  if (!this.verifyAuth(authHeader, expectedSecret)) {
    throw new UnauthorizedException();
  }
  ```

---

### MEDIUM-01: No Password Complexity Requirements

- **Severity:** Medium
- **CWE:** CWE-521 (Weak Password Requirements)
- **OWASP:** A07:2021 - Identification and Authentication Failures
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/auth/dto/register.dto.ts:11`
- **Code:**
  ```typescript
  @MinLength(8)
  password!: string;
  ```
- **Description:** Only `MinLength(8)` is enforced. No requirement for uppercase, lowercase, digits, or special characters. Allows passwords like "aaaaaaaa".
- **Recommendation:** Add `@Matches` for complexity:
  ```typescript
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/, {
    message: 'Password must contain uppercase, lowercase, digit, and special character',
  })
  ```

---

### MEDIUM-02: No Account Lockout / Brute Force Protection on Login

- **Severity:** Medium
- **CWE:** CWE-307 (Improper Restriction of Excessive Authentication Attempts)
- **OWASP:** A07:2021 - Identification and Authentication Failures
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/auth/auth.controller.ts:30-34`
- **Description:** The login endpoint has no rate limiting or account lockout. ThrottlerGuard is only applied to AI endpoints. An attacker can brute-force passwords with unlimited attempts.
- **Recommendation:** Apply `@Throttle()` or a custom rate-limiting guard on auth endpoints:
  ```typescript
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  ```

---

### MEDIUM-03: SSL Certificate Verification Disabled for Database

- **Severity:** Medium
- **CWE:** CWE-295 (Improper Certificate Validation)
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/database/database.module.ts:41` and `/Users/tienthanh/Documents/new_flowering/be_flowering/src/database/typeorm-data-source.ts:10`
- **Code:**
  ```typescript
  ssl: { rejectUnauthorized: false },
  ```
- **Description:** Both database connections disable SSL certificate verification. This makes connections vulnerable to man-in-the-middle attacks where an attacker intercepts database traffic.
- **Recommendation:** Set `rejectUnauthorized: true` and provide the CA certificate for Supabase. In production, always validate certificates. Use environment-conditional config:
  ```typescript
  ssl: nodeEnv === 'production'
    ? { rejectUnauthorized: true, ca: process.env.DB_CA_CERT }
    : { rejectUnauthorized: false },
  ```

---

### MEDIUM-04: No Helmet Security Headers

- **Severity:** Medium
- **CWE:** CWE-693 (Protection Mechanism Failure)
- **OWASP:** A05:2021 - Security Misconfiguration
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/main.ts` (missing)
- **Description:** The application does not use `helmet` middleware. Missing security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`, `X-XSS-Protection`.
- **Recommendation:**
  ```bash
  npm install helmet
  ```
  ```typescript
  import helmet from 'helmet';
  app.use(helmet());
  ```

---

### MEDIUM-05: Error Handler Leaks Raw Exception Messages

- **Severity:** Medium
- **CWE:** CWE-209 (Generation of Error Message Containing Sensitive Information)
- **OWASP:** A09:2021 - Security Logging and Monitoring Failures
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/common/filters/all-exceptions.filter.ts:36-38`
- **Code:**
  ```typescript
  } else if (exception instanceof Error) {
    message = exception.message;
  }
  ```
- **Description:** Non-HTTP exceptions (TypeORM errors, system errors) have their raw `error.message` returned in the API response. This can leak database schema details, file paths, or internal implementation details to attackers.
- **Recommendation:** For non-HttpException errors, always return a generic message to the client:
  ```typescript
  } else if (exception instanceof Error) {
    // Log the real message server-side only
    console.error('Unhandled exception:', exception.message, exception.stack);
    message = 'Internal server error';
  }
  ```

---

### MEDIUM-06: In-Memory Idempotency Set for Webhooks (Memory Leak + Lost on Restart)

- **Severity:** Medium
- **CWE:** CWE-400 (Uncontrolled Resource Consumption)
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/subscription/subscription.service.ts:20`
- **Code:**
  ```typescript
  private processedEvents = new Set<string>();
  ```
- **Description:** Processed webhook event IDs are stored in an in-memory `Set`. This grows unboundedly over time (memory leak) and is lost on server restart (allowing event replay). In a multi-instance deployment, different instances have different sets (split-brain idempotency).
- **Recommendation:** Use a database table or Redis with TTL for idempotency tracking:
  ```typescript
  // Check if event already processed in DB
  const existing = await this.webhookEventRepo.findOne({ where: { eventId: event.id } });
  if (existing) return;
  await this.webhookEventRepo.save({ eventId: event.id, processedAt: new Date() });
  ```

---

### MEDIUM-07: File Upload MIME Type Validation is Bypassable

- **Severity:** Medium
- **CWE:** CWE-434 (Unrestricted Upload of File with Dangerous Type)
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/ai/ai.controller.ts:134`
- **Code:**
  ```typescript
  if (!audio.mimetype.startsWith('audio/')) {
    throw new BadRequestException('Invalid audio file type');
  }
  ```
- **Description:** MIME type checking relies on the `Content-Type` header sent by the client, which is trivially spoofable. An attacker can upload any file type (executable, malicious content) by setting the MIME type to `audio/mpeg`. No file magic byte validation is performed.
- **Recommendation:** Add Multer file filter with magic byte validation. Also restrict allowed extensions:
  ```typescript
  @UseInterceptors(FileInterceptor('audio', {
    fileFilter: (req, file, cb) => {
      const allowedMimes = ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg'];
      if (!allowedMimes.includes(file.mimetype)) {
        return cb(new BadRequestException('Invalid audio type'), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  ```
  Additionally, validate file magic bytes server-side using a library like `file-type`.

---

### MEDIUM-08: No Rate Limiting on Auth Endpoints (Register/Login/Refresh)

- **Severity:** Medium
- **CWE:** CWE-799 (Improper Control of Interaction Frequency)
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/auth/auth.controller.ts`
- **Description:** While AI endpoints have ThrottlerGuard, auth endpoints (register, login, refresh, apple auth) have no rate limiting. This enables credential stuffing, account enumeration, and brute-force attacks.
- **Recommendation:** Apply ThrottlerModule globally or specifically to auth routes with appropriate limits (e.g., 5 login attempts per minute per IP).

---

### LOW-01: OAuth Error Message Reveals Auth Provider

- **Severity:** Low
- **CWE:** CWE-200 (Exposure of Sensitive Information)
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/auth/auth.service.ts:87`
- **Code:**
  ```typescript
  throw new ConflictException(
    `Email already registered with ${existingEmailUser.authProvider}`,
  );
  ```
- **Description:** Reveals which OAuth provider a user originally registered with. This leaks information that aids social engineering attacks.
- **Recommendation:** Use generic message: `'Email already registered with another method'`.

---

### LOW-02: Swagger Docs Available in Non-Production (Including Staging)

- **Severity:** Low
- **CWE:** CWE-200
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/main.ts:43`
- **Code:**
  ```typescript
  if (nodeEnv !== 'production') {
    setupSwaggerDocumentation(app);
  }
  ```
- **Description:** Swagger is available in all environments except `production`, including `staging` or `test`. This exposes full API documentation to potentially wider audiences.
- **Recommendation:** Restrict Swagger to `development` only, or add authentication to the Swagger UI endpoint.

---

### LOW-03: Console.log Used for Production Logging

- **Severity:** Low
- **CWE:** CWE-778 (Insufficient Logging)
- **Location:** Multiple files (`main.ts:45,49`, `all-exceptions.filter.ts:41`)
- **Description:** Raw `console.log` and `console.error` are used instead of NestJS Logger with structured output. This provides no log levels, no timestamps, no correlation IDs in production, making incident investigation difficult.
- **Recommendation:** Use NestJS `Logger` consistently. Consider adding a request-scoped correlation ID.

---

### LOW-04: Database Logging Enabled in Development Mode

- **Severity:** Low
- **CWE:** CWE-532 (Insertion of Sensitive Information into Log File)
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/database/database.module.ts:50`
- **Code:**
  ```typescript
  logging: configService.get<string>('nodeEnv') === 'development',
  ```
- **Description:** SQL query logging in development mode may log sensitive data (passwords before hashing, personal data). While development-only, devs often work with production-like data.
- **Recommendation:** Use selective logging: `logging: ['error', 'warn', 'migration']` in development instead of full query logging.

---

### LOW-05: TypeORM Data Source Has Always-On Logging

- **Severity:** Low
- **CWE:** CWE-532
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/database/typeorm-data-source.ts:15`
- **Code:**
  ```typescript
  logging: true,
  ```
- **Description:** The migration data source has logging always enabled, including in production. This logs all SQL queries including any with sensitive data.
- **Recommendation:** Use `logging: process.env.NODE_ENV === 'development'`.

---

### INFO-01: Missing CSRF Protection

- **Severity:** Info
- **CWE:** CWE-352
- **Location:** Application-wide
- **Description:** No CSRF protection middleware is configured. Since this is primarily a JWT-based API consumed by mobile apps, CSRF risk is lower. However, the Google OAuth callback uses session-based redirect flow which could be CSRF-vulnerable.
- **Recommendation:** For API-only JWT auth, CSRF is not critical. If browser-based clients are used, consider adding CSRF tokens for the OAuth flows.

---

### INFO-02: No API Versioning

- **Severity:** Info
- **Location:** Application-wide
- **Description:** No API versioning strategy is implemented. Breaking changes will affect all clients simultaneously.
- **Recommendation:** Implement NestJS versioning: `app.enableVersioning({ type: VersioningType.URI })`.

---

### INFO-03: Refresh Token Not Bound to Device/IP

- **Severity:** Info
- **CWE:** CWE-384
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/auth/auth.service.ts:170-193`
- **Description:** Refresh tokens are not bound to any device fingerprint, IP address, or user agent. A stolen refresh token can be used from any location.
- **Recommendation:** Store device fingerprint (user-agent hash) with refresh tokens and validate on refresh.

---

### INFO-04: No Stale Refresh Token Cleanup

- **Severity:** Info
- **Location:** `/Users/tienthanh/Documents/new_flowering/be_flowering/src/database/entities/refresh-token.entity.ts`
- **Description:** Expired and revoked refresh tokens accumulate in the database indefinitely. This affects the performance of HIGH-02 (full table scan) and wastes storage.
- **Recommendation:** Implement a scheduled job to purge expired/revoked tokens older than 90 days.

---

## Dependency Vulnerability Summary (npm audit)

| Package | Severity | Advisory |
|---------|----------|----------|
| fast-xml-parser | Critical | DoS via entity expansion (GHSA-jmr7-xgp7-cmfj) + regex injection bypass (GHSA-m7jm-9gc2-mpf2) |
| @isaacs/brace-expansion | High | Uncontrolled resource consumption (GHSA-7h2j-956f-4vf2) |
| minimatch | High | ReDoS via repeated wildcards (GHSA-3ppc-4f35-3m26) -- 10 paths |
| ajv | Moderate | ReDoS with $data option (GHSA-2g4f-4pwh-qvx6) -- 4 paths |
| lodash | Moderate | Prototype pollution in _.unset/_.omit (GHSA-xxjr-mmjv-4gpg) |
| qs | High | arrayLimit bypass causing DoS (GHSA-w7fw-mjwx-w883) |

**Total: 45 vulnerabilities (1 low, 8 moderate, 35 high, 1 critical)**

**Immediate Action:** Run `npm audit fix` to resolve fixable vulnerabilities (fast-xml-parser, lodash, qs, brace-expansion). The minimatch and ajv issues are in dev dependencies (jest, eslint, @nestjs/cli) and require breaking changes to fully resolve.

---

## Risk Matrix

```
                    Low Impact    Medium Impact    High Impact    Critical Impact
                  +--------------+----------------+--------------+----------------+
  Easy to         |              | MEDIUM-01      | HIGH-04      | CRITICAL-01    |
  Exploit         |              | MEDIUM-02      | HIGH-05      |                |
                  |              | MEDIUM-08      |              |                |
                  +--------------+----------------+--------------+----------------+
  Moderate        | LOW-01       | MEDIUM-05      | HIGH-01      | CRITICAL-02    |
  Exploitability  | LOW-02       | MEDIUM-06      | HIGH-02      |                |
                  |              | MEDIUM-07      | HIGH-03      |                |
                  +--------------+----------------+--------------+----------------+
  Difficult       | LOW-03       | MEDIUM-03      |              |                |
  to Exploit      | LOW-04       | MEDIUM-04      |              |                |
                  | LOW-05       |                |              |                |
                  +--------------+----------------+--------------+----------------+
```

---

## Remediation Roadmap

### Phase 1: Immediate (0-48 hours)
1. **CRITICAL-01:** Remove fallback JWT secret; throw on missing secret
2. **CRITICAL-02:** Run `npm audit fix`
3. **HIGH-05:** Require webhook secret; reject unauthenticated webhooks
4. **HIGH-04:** Fix CORS to never allow wildcard with credentials

### Phase 2: Urgent (1-2 weeks)
5. **HIGH-01:** Reduce access token expiry to 15 minutes
6. **HIGH-02:** Redesign refresh token lookup with indexed prefix
7. **HIGH-03:** Add ownership check to conversation messages endpoint
8. **MEDIUM-02:** Add rate limiting to auth endpoints
9. **MEDIUM-05:** Sanitize error messages for non-HTTP exceptions

### Phase 3: Important (2-4 weeks)
10. **MEDIUM-01:** Add password complexity requirements
11. **MEDIUM-03:** Enable SSL certificate verification for production
12. **MEDIUM-04:** Install and configure `helmet`
13. **MEDIUM-06:** Migrate webhook idempotency to database/Redis
14. **MEDIUM-07:** Add server-side file type validation with magic bytes
15. **MEDIUM-08:** Apply rate limiting to register and refresh endpoints

### Phase 4: Improvement (1-2 months)
16. **LOW-01:** Generic error messages for auth provider disclosure
17. **LOW-03:** Replace console.log with structured NestJS Logger
18. **LOW-04/05:** Restrict database query logging
19. **INFO-03:** Bind refresh tokens to device fingerprint
20. **INFO-04:** Add scheduled cleanup for expired refresh tokens

---

## Positive Security Practices Observed

1. **Global JWT Guard** -- All routes protected by default; `@Public()` required to opt out. This is the correct pattern.
2. **Parameterized Queries** -- TypeORM repositories are used consistently; no raw SQL with string concatenation in application code.
3. **bcrypt with 12 rounds** -- Proper password hashing with adequate cost factor.
4. **Input Validation** -- `class-validator` with `whitelist: true` and `forbidNonWhitelisted: true` prevents mass assignment.
5. **RLS Policies** -- Row-level security at the database layer provides defense-in-depth (though bypassed by service-role connection).
6. **Webhook Timing-Safe Comparison** -- `timingSafeEqual` used for webhook auth (when configured).
7. **Env Validation** -- Joi schema validates environment variables at startup with `abortEarly: false`.
8. **Secrets in .gitignore** -- `.env` files properly excluded from git.
9. **Error Response Wrapping** -- `AllExceptionsFilter` prevents raw exception stack traces from reaching clients (for HTTP exceptions).
10. **UUID Primary Keys** -- Non-enumerable, reducing IDOR attack surface.

---

## Unresolved Questions

1. Does the Supabase service-role connection bypass RLS? If yes, the application-level ownership checks become the sole authorization boundary (currently incomplete for conversations).
2. Is the `refresh_tokens` table cleaned up by any external process (cron, Supabase function)?
3. Are there plans for admin/internal endpoints that may require role-based access control beyond the current user-only model?
4. What is the expected deployment topology (single instance vs. multi-instance)? This affects the webhook idempotency finding severity.
