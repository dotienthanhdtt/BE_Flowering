# Code Review: camelCase ↔ snake_case HTTP Boundary

**Date:** 2026-03-28
**Branch:** refactor/code-cleanup
**Files:**
- `src/common/utils/case-converter.ts`
- `src/common/interceptors/response-transform.interceptor.ts`
- `src/main.ts`

---

## Overall Assessment

The design is clean and the boundary placement is correct. Most issues are edge-case bugs rather than
security problems. One issue is a silent data-corruption risk on existing `BaseResponseDto` responses
(the bypass branch does not apply `toSnakeCase` to the inner `data` payload). Another is a PascalCase
regex bug that will silently mis-key response fields. Everything else is medium or lower.

**Rating: 6 / 10** — functional for the happy path, but two bugs will silently produce wrong keys or
swallow the conversion entirely for a common code path.

---

## Critical Issues

### 1. `BaseResponseDto` bypass skips key conversion — silent data corruption

**File:** `response-transform.interceptor.ts`, line 13–15

```ts
if (data instanceof BaseResponseDto) {
  return data;   // ← camelCase keys escape to mobile client
}
```

Controllers that explicitly return `BaseResponseDto.success(someDto)` will bypass conversion entirely.
The `data` payload inside the wrapper still has camelCase keys. The mobile app expects snake_case on
every field including nested `data`. This is a silent divergence that CI will not catch and only
manifests at runtime when the mobile client can't find a field.

The interceptor already handles the wrapping for controllers that return a plain object. Controllers
that return `BaseResponseDto` directly (pattern used throughout the codebase per the project
standards) will never be converted.

**Fix:** Apply `toSnakeCase` to the `.data` field before returning:

```ts
if (data instanceof BaseResponseDto) {
  return new BaseResponseDto(
    data.code,
    data.message,
    toSnakeCase(data.data) as T,
  );
}
```

---

### 2. `camelToSnakeKey` regex fires on the first character of PascalCase keys

**File:** `case-converter.ts`, line 3

```ts
return key.replace(/([A-Z])/g, (char) => `_${char.toLowerCase()}`);
```

`"UserId"` → `"_user_id"` (leading underscore).
`"HTTPStatus"` → `"_h_t_t_p_status"` (each capital letter gets its own underscore).

Any TypeORM entity or DTO with a PascalCase property name, or any acronym-named field (`userId` is
fine, but `HTTPStatusCode` is not), will produce a malformed key that the mobile client cannot map.

**Fix:** Skip a leading uppercase letter and handle consecutive caps as a block:

```ts
export function camelToSnakeKey(key: string): string {
  return key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')  // split acronym runs
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')        // split camel boundaries
    .toLowerCase();
}
```

This handles `HTTPStatusCode` → `http_status_code`, `userId` → `user_id`, `UserId` → `user_id`.

---

## High Priority

### 3. Webhook exclusion path does not account for NestJS global prefix

**File:** `main.ts`, line 21

```ts
if (!req.path.startsWith('/webhooks/'))
```

If a global route prefix is ever added via `app.setGlobalPrefix('api')`, the actual path for the
RevenueCat endpoint becomes `/api/webhooks/revenuecat`. The `startsWith('/webhooks/')` guard will no
longer match, so the body **will** be camelCase-converted before the DTO receives it — breaking
`app_user_id`, `original_app_user_id`, etc. and causing silent validation failures.

This is latent: it has no impact today (no global prefix), but is one config change away from a
production outage.

**Fix:** Also match with a prefix variant, or use a regex:

```ts
const isWebhook = req.path === '/webhooks' ||
                  req.path.startsWith('/webhooks/') ||
                  req.path.includes('/webhooks/');
```

Or explicitly document in `main.ts` that `setGlobalPrefix` must never be used, and add a startup
assertion.

---

### 4. Class instances other than `Date` are silently stripped to plain objects

**File:** `case-converter.ts`, line 18

```ts
if (typeof value === 'object') {
  const result: PlainObject = {};
  for (const [k, v] of Object.entries(value as PlainObject)) {
```

`Object.entries` on a class instance only returns own enumerable properties. Prototype methods, getter
properties, and non-enumerable fields are dropped. If `toSnakeCase` is ever called on a serialized
entity class (TypeORM entities with `@Column` properties are plain-object by the time they reach the
interceptor in typical NestJS flow, so this is lower risk), the output is an incomplete plain object.

More concretely: if a response payload contains a `Buffer` or `Map` or `Set`, `typeof value === 'object'`
is true, `Object.entries` returns nothing useful, and the result is silently `{}`.

**Fix:** Add guards for common non-plain object types before the generic `object` branch:

```ts
if (value instanceof Buffer || value instanceof Map || value instanceof Set) {
  return value;
}
```

---

## Medium Priority

### 5. `toCamelCase` does not handle leading/trailing underscores or double underscores

**File:** `case-converter.ts`, line 8

```ts
return key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
```

- `"__type"` → `"_type"` (one underscore dropped, other preserved — inconsistent)
- `"_private"` → `"_private"` (unchanged — correct, but undocumented)
- `"some__field"` → `"some_field"` (one underscore consumed, output still has underscore)

These edge cases are unlikely in RevenueCat payloads but are possible in other future webhook
integrations. The behaviour is deterministic but surprising. Document the limitation or handle it.

---

### 6. Response interceptor converts `BaseResponseDto` wrapper fields themselves

Even after the fix from issue #1, the `code` and `message` fields on `BaseResponseDto` will be passed
through `toSnakeCase`. Those are already snake-friendly single words so the output is unchanged today,
but if the DTO ever gains a field like `requestId`, it will be silently renamed to `request_id` in the
wrapper envelope — which may break mobile clients reading the envelope. Low risk now, worth noting.

---

### 7. Middleware runs before body has been fully parsed in some edge cases

**File:** `main.ts`, line 20–25

`app.use(...)` is registered before `useGlobalPipes`. In NestJS/Express, `app.use` middleware fires
before NestJS's internal pipe stack, but it fires **after** the body-parser middleware that NestJS
registers by default. This ordering is correct for the happy path.

However, if raw body is needed for any future webhook HMAC verification (Stripe, Apple etc.), the
`req.body` is the parsed JSON object by the time this middleware runs — raw body access requires
separate `express.raw()` middleware registered earlier. Not a current bug, but a constraint to
document.

---

## Low Priority

### 8. `toSnakeCase` / `toCamelCase` are not memoised

For large deeply-nested response payloads these functions do a full recursive traversal on every
request. There is no memoisation. This is acceptable for typical API responses but worth noting if
large AI conversation history objects are returned.

---

### 9. `corsOrigins` fallback `true` allows any origin

**File:** `main.ts`, line 47–48

```ts
origin: corsOrigins ? corsOrigins.split(',').map((o) => o.trim()) : true,
```

When `CORS_ORIGINS` env var is not set, `origin: true` reflects the `Origin` header back, effectively
allowing any origin. This is acceptable in dev but if the env var is accidentally unset in production
the API becomes fully open. A stricter default (e.g., the production domain) would be safer.

---

## Edge Case Matrix

| Input | `camelToSnakeKey` (current) | `camelToSnakeKey` (fixed) |
|---|---|---|
| `"userId"` | `"user_id"` ✓ | `"user_id"` ✓ |
| `"UserId"` | `"_user_id"` BUG | `"user_id"` ✓ |
| `"HTTPStatus"` | `"_h_t_t_p_status"` BUG | `"http_status"` ✓ |
| `"already_snake"` | `"already_snake"` ✓ | `"already_snake"` ✓ |
| `""` (empty) | `""` ✓ | `""` ✓ |

| Input value | `toSnakeCase` result |
|---|---|
| `null` | `null` ✓ |
| `undefined` | `undefined` ✓ |
| `new Date()` | `Date` object ✓ |
| `[{userId: 1}]` | `[{user_id: 1}]` ✓ |
| `new Map()` | `{}` (silent strip) BUG |
| `Buffer.from(...)` | `{}` (silent strip) BUG |
| Class instance | Own enumerable props only |

---

## Positive Observations

- Timing-safe webhook auth comparison (`timingSafeEqual`) is correct and avoids timing attacks.
- The webhook exclusion design is architecturally correct: keep raw snake_case for external providers.
- `AllExceptionsFilter` prevents raw stack traces from leaking — good.
- `setImmediate` for async webhook processing is the right pattern to meet RevenueCat's 60s SLA.
- `whitelist: true` + `forbidNonWhitelisted: true` on `ValidationPipe` is a solid default.
- `toCamelCase` middleware placement before `ValidationPipe` is the correct order.

---

## Recommended Actions (Priority Order)

1. **[Critical]** Fix `BaseResponseDto` bypass in interceptor — apply `toSnakeCase` to `.data` before returning.
2. **[Critical]** Fix `camelToSnakeKey` regex for PascalCase and acronym keys.
3. **[High]** Add `Buffer`, `Map`, `Set` passthrough guards in `toSnakeCase`/`toCamelCase`.
4. **[High]** Document or guard against `setGlobalPrefix` breaking the webhook exclusion path.
5. **[Medium]** Tighten CORS default away from `origin: true`.

---

## Unresolved Questions

1. Are any controllers in the codebase returning `BaseResponseDto` directly (not relying on the interceptor to wrap)? If so, issue #1 is already causing wrong keys in production responses.
2. Is there a plan to add more webhook providers (Stripe, Apple IAP)? If yes, the webhook exclusion strategy needs to be extracted to a config list rather than a hardcoded path prefix.
3. Do any response DTOs have PascalCase property names (from TypeORM entities with `@Column({ name: ... })`)?
