# Phase 1 — Request Context Infrastructure

**Priority:** P0 · **Effort:** 2h · **Status:** complete

## Context

- Brainstorm §Final Architecture 1. [brainstorm](../reports/brainstorm-260418-2114-multi-language-content-architecture.md)
- Existing decorator pattern: `src/common/decorators/public-route.decorator.ts`, `optional-auth.decorator.ts`
- Existing guards: `src/common/guards/premium.guard.ts`, `src/modules/auth/guards/jwt-auth.guard.ts`
- JWT guard is global → our guard runs AFTER user is attached to request

## Goal

Resolve active learning language per request. Provide `@ActiveLanguage()` parameter decorator returning `{ id, code }` attached to `request.activeLanguage`. `LanguageContextGuard` populates it from `X-Learning-Language` header or falls back to `UserLanguage.isActive`.

## Key Insights

- `Language.code` is short (≤10 chars, e.g. `en`, `es`). `Language.id` is UUID. Services use UUID in FKs.
- Header carries the **code**; guard must resolve code → UUID once per request.
- Guard runs after JWT, so `request.user` is available for fallback.
- Anonymous (onboarding) endpoints use `@OptionalAuth` or `@Public` → fallback cannot rely on user. In those contexts the header is required (validate in dto/controller).

## Requirements

### Functional
- FR1: Decorator `@ActiveLanguage()` returns `{ id: string, code: string }` from `request.activeLanguage`
- FR2: Guard validates header code against `languages.is_active = true`
- FR3: Guard enforces code is in user's `user_languages` (authenticated only) — prevents querying another language
- FR4: Missing header (authenticated) → look up `UserLanguage.isActive = true`, log warning
- FR5: Missing header + no active UserLanguage → `BadRequestException('Active learning language required')`
- FR6: Opt-out via `@SkipLanguageContext()` decorator for routes that don't need it (e.g. `/languages`, `/auth/*`)

### Non-Functional
- Zero extra DB call when header present and valid (single `Language` lookup, cacheable in-memory for ~60s)
- In-memory LRU cache of `code → { id, code }` (10 entries max — we have ≤10 languages)

## Architecture

```
Request
  ↓ JwtAuthGuard (global)
  ↓ LanguageContextGuard (global OR scoped)
      1. Skip if @Public or @SkipLanguageContext
      2. Read X-Learning-Language header
      3. Cache hit → attach request.activeLanguage, return true
      4. Cache miss → DB SELECT id, code FROM languages WHERE code=? AND is_active=true
      5. Authenticated? verify row exists in user_languages
      6. No header + authenticated → fallback UserLanguage.isActive
      7. Attach request.activeLanguage = { id, code }
  ↓ Handler reads via @ActiveLanguage()
```

## Related Code Files

### Create
- `src/common/decorators/active-language.decorator.ts` — param decorator + `@SkipLanguageContext()`
- `src/common/guards/language-context.guard.ts` — resolution + fallback logic
- `src/common/services/language-context-cache.service.ts` — tiny LRU for code→{id,code}
- `src/common/decorators/active-language.decorator.spec.ts`
- `src/common/guards/language-context.guard.spec.ts`

### Modify
- `src/common/index.ts` — re-export new symbols
- `src/app.module.ts` — register `LanguageContextGuard` as `APP_GUARD` provider (scoped via `@SkipLanguageContext()` on auth/language/healthcheck routes)

## Implementation Steps

1. **`active-language.decorator.ts`**
   ```ts
   export interface ActiveLanguageContext { id: string; code: string; }
   export const ActiveLanguage = createParamDecorator(
     (_: unknown, ctx: ExecutionContext): ActiveLanguageContext => {
       const req = ctx.switchToHttp().getRequest();
       if (!req.activeLanguage) throw new InternalServerErrorException('LanguageContextGuard not applied');
       return req.activeLanguage;
     },
   );
   export const SKIP_LANGUAGE_CONTEXT = 'skipLanguageContext';
   export const SkipLanguageContext = () => SetMetadata(SKIP_LANGUAGE_CONTEXT, true);
   ```

2. **`language-context-cache.service.ts`** — `Map<string, ActiveLanguageContext>` wrapped with size cap + TTL 60s. Loaded from `Language` repo.

3. **`language-context.guard.ts`**
   - Reflector reads `SKIP_LANGUAGE_CONTEXT` + `IS_PUBLIC_KEY` → short-circuit true
   - Read `request.headers['x-learning-language']` (case-insensitive)
   - If present: cache.get/load; if `!row.isActive` → `BadRequestException`
   - Authenticated: assert `user_languages` row exists (`userId`, `languageId`). 404 → `ForbiddenException('Language not enrolled')`
   - No header + authenticated: fallback `userLanguageRepo.findOne({ where: { userId, isActive: true } })`; log warn via `Logger`
   - No header + anonymous: `BadRequestException('X-Learning-Language header required for anonymous requests')`
   - Attach `request.activeLanguage = { id, code }`

4. **Register guard** in `app.module.ts`:
   ```ts
   { provide: APP_GUARD, useClass: LanguageContextGuard }
   ```
   Add `@SkipLanguageContext()` on: `AuthController`, `LanguageController`, `HealthController` (if any), `UserController` profile endpoints.

5. **Build** `npm run build` — fix TS errors.

6. **Unit tests** (jest):
   - Decorator throws if guard not applied
   - Guard: header valid → attaches context
   - Guard: header invalid code → 400
   - Guard: header valid but not in user_languages → 403
   - Guard: missing header + authenticated fallback works
   - Guard: missing header + anonymous → 400
   - Guard: `@SkipLanguageContext` bypasses all checks
   - Cache: repeat code lookup → only 1 DB call

## Todo

- [x] Create `active-language.decorator.ts`
- [x] Create `language-context-cache.service.ts`
- [x] Create `language-context.guard.ts`
- [x] Export via `src/common/index.ts`
- [x] Register in `app.module.ts` as `APP_GUARD`
- [x] Apply `@SkipLanguageContext()` to AuthController, LanguageController
- [x] Unit tests for decorator + guard + cache
- [x] `npm run build` clean
- [x] `npm test -- src/common` green

## Success Criteria

- `request.activeLanguage` populated on every protected route
- Ambient use: controllers inject `@ActiveLanguage() lang` with zero boilerplate
- Fallback logged (`Logger.warn('X-Learning-Language missing; using UserLanguage.isActive')`) so ops can monitor mobile compliance

## Risk Assessment

- **Global guard ordering** — must run AFTER JwtAuthGuard. NestJS runs `APP_GUARD`s in registration order → register JWT first, language second. Verify via test.
- **Cache staleness** — Language rows rarely change (isActive flip). 60s TTL acceptable. Invalidation on admin update: out of scope for Phase 1.
- **Breaking existing tests** — skip-list must cover every existing route without `languageId` context (all auth, profile, lang mgmt). Audit controllers before merge.

## Security Considerations

- Guard MUST verify enrollment (`user_languages`) to prevent IDOR (user guesses a language and reads content they haven't paid for / enrolled in)
- Header value sanitized via `Language.code` whitelist — no SQL injection surface
- Anonymous endpoints: bypass via `@Public` is fine; onboarding still needs language — handle in Phase 4

## Next Steps

Phase 2 — schema migrations to make denormalized `languageId` columns exist so Phase 3 services can filter.
