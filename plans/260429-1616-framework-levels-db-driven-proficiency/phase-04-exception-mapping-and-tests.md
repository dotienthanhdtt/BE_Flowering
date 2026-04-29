# Phase 04 — Map P0001 to 400, update tests

## Overview
- **Priority:** High
- **Status:** pending
- **Effort:** S
- **Depends on:** Phase 03

## Requirements
- Postgres `RAISE EXCEPTION` (`P0001`) from trigger surfaces as HTTP 400 with the trigger's message, not 500
- Existing tests updated for removed/renamed APIs
- New integration tests cover trigger behavior

## Related Code Files
**Modify:**
- `src/common/filters/all-exceptions.filter.ts` — detect `QueryFailedError` with `code === 'P0001'`, return 400 with `error.message`
- `src/modules/language/language.service.spec.ts` — drop `resolveAndValidateLevel` tests; update level-validation expectations (now thrown by DB, not service)
- `src/modules/auth/auth.service.spec.ts` — drop assertions on `proficiencyLevel` in bootstrap insert
- `src/common/guards/language-context.guard.spec.ts` — drop default-level assertions

**Create:**
- `src/database/migrations/__tests__/framework-levels.integration.spec.ts` (or co-located) — integration test against real Postgres:
  - Insert without level → row gets framework[0]
  - Insert invalid level → 400 (via controller) or `P0001` (via repo)
  - Update to invalid level → 400

## Implementation Steps
1. Locate `AllExceptionsFilter`. Add branch:
   ```ts
   if (exception instanceof QueryFailedError && (exception as any).code === 'P0001') {
     return response.status(400).json({
       code: 0,
       message: (exception as any).message ?? 'Invalid input',
       data: null,
     });
   }
   ```
2. Update affected unit tests
3. Add integration test (only if test infra supports real DB; skip with TODO if not)
4. Run `npm test` — all green

## Todo
- [ ] Filter maps `P0001` → 400
- [ ] `language.service.spec.ts` updated
- [ ] `auth.service.spec.ts` updated
- [ ] Guard spec updated
- [ ] Integration test added (or TODO logged)
- [ ] All tests pass

## Success Criteria
- `npm test` green
- Manual curl: `POST /user-languages {"languageId":"…","proficiencyLevel":"ZZZ"}` → 400 with descriptive message

## Risks
- If existing exception filter already special-cases `QueryFailedError` for other codes (23xxx), don't break those branches
- Trigger error messages contain raw level codes — fine to expose; nothing sensitive
