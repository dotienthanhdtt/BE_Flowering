# Brainstorm — Scenario Detail API (`GET /scenarios/:id`)

**Date:** 2026-04-21
**Branch:** dev
**Status:** Design approved — ready for `/ck:plan`

---

## 1. Problem Statement

Mobile app needs a dedicated scenario detail screen (title + description + image + category + access state) that loads *before* the chat screen. Current backend exposes only list endpoints (`/scenarios/default`, `/scenarios/personal`). No single-scenario detail endpoint exists.

**Goal:** Ship `GET /scenarios/:id` that any authenticated user can call, returns full detail, and flags whether the user is actually allowed to start chat — so UI can render a preview + "upgrade" CTA for locked premium scenarios without a second round-trip.

---

## 2. Requirements

### Functional
- `GET /scenarios/:id` returns scenario detail for any authenticated user.
- Response includes core fields + category + access metadata (`accessTier`, `isLocked`, `lockReason`).
- Respects active learning language — returns 404 if `scenario.languageId !== activeLanguageId`.
- Returns 404 if scenario missing or not `PUBLISHED`.
- Premium scenarios return 200 with `isLocked=true, lockReason='premium_required'` when user lacks subscription + grant.

### Non-functional
- Single round-trip (no separate `/access` probe).
- No rate limit (user-triggered, 1 call per tap).
- Reuse existing access rules — no duplication with chat flow.
- Swagger documented.

---

## 3. Approaches Evaluated

### A. Inline try/catch on `findAccessibleScenario`
Call existing `findAccessibleScenario`; catch `ForbiddenException` → refetch + mark locked.
- **Pros:** zero changes to access service; smallest diff.
- **Cons:** exception-as-control-flow; double DB read on premium block; fragile to future access-service behavior changes.

### B. Non-throwing `checkAccess` method on `ScenarioAccessService` ✅ **CHOSEN**
Add `checkAccess(userId, id, languageId): { scenario, isLocked, lockReason }` that:
- Throws `NotFoundException` for missing / language mismatch (hard errors).
- Returns `isLocked=true` for premium block (soft state).
- **Pros:** single source of truth for access rules; no exception gymnastics; single DB read; chat flow keeps using the existing throwing `findAccessibleScenario` unchanged.
- **Cons:** one extra method on access service (~30 LoC).

### C. Two endpoints (detail + access probe)
Detail endpoint always returns data; separate `/scenarios/:id/access` probe.
- **Pros:** clean separation.
- **Cons:** two round-trips per tap; violates KISS; no real benefit for this UX.

---

## 4. Recommended Solution

### 4.1 Endpoint contract

```
GET /scenarios/:id
Headers:
  Authorization: Bearer <jwt>
  X-Learning-Language: <code>   # required, AutoEnrollLanguage
```

### 4.2 Response DTO — `ScenarioDetailDto`

```ts
class CategoryRefDto {
  id: string;
  name: string;
}

class ScenarioDetailDto {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  difficulty: ScenarioDifficulty;
  languageId: string;
  orderIndex: number;
  category: CategoryRefDto;

  // access
  accessTier: AccessTier;               // FREE | PREMIUM
  isLocked: boolean;
  lockReason?: 'premium_required';      // only when isLocked=true
}
```

Wrapped by `ResponseTransformInterceptor` → `{ code: 1, message: 'Success', data: ScenarioDetailDto }`.

### 4.3 Behavior matrix

| Case | HTTP | `isLocked` | `lockReason` |
|------|------|------------|--------------|
| Not found or `status != PUBLISHED` | 404 | — | — |
| `scenario.languageId !== activeLanguageId` | 404 | — | — |
| FREE tier | 200 | false | absent |
| PREMIUM + subscription active OR explicit grant | 200 | false | absent |
| PREMIUM + no subscription, no grant | 200 | true | `premium_required` |

### 4.4 Service flow

```ts
// ScenarioAccessService — NEW method (non-throwing soft-lock)
async checkAccess(userId, scenarioId, languageId): Promise<{
  scenario: Scenario;
  isLocked: boolean;
  lockReason?: 'premium_required';
}> {
  const scenario = await scenarioRepo.findOne({
    where: { id: scenarioId, status: PUBLISHED },
    relations: ['category'],
  });
  if (!scenario) throw new NotFoundException('Scenario not found');
  if (scenario.languageId !== languageId) {
    throw new NotFoundException('Scenario not available for active language');
  }
  if (scenario.accessTier !== AccessTier.PREMIUM) {
    return { scenario, isLocked: false };
  }
  const [sub, grant] = await Promise.all([
    subscriptionService.getUserSubscription(userId),
    accessRepo.findOne({ where: { userId, scenarioId } }),
  ]);
  if (sub?.isActive || grant) return { scenario, isLocked: false };
  return { scenario, isLocked: true, lockReason: 'premium_required' };
}

// ScenariosDetailService.get(userId, scenarioId, languageId)
const { scenario, isLocked, lockReason } =
  await access.checkAccess(userId, scenarioId, languageId);
return toDto(scenario, { isLocked, lockReason });
```

Existing `findAccessibleScenario` (chat flow) stays unchanged — keeps throwing on premium block. DRY via shared private helpers if needed later.

---

## 5. Files to Touch

| Action | Path |
|--------|------|
| NEW | `src/modules/scenario/dto/scenario-detail.dto.ts` |
| NEW | `src/modules/scenario/services/scenarios-detail.service.ts` |
| NEW | `src/modules/scenario/services/scenarios-detail.service.spec.ts` |
| MODIFY | `src/modules/scenario/services/scenario-access.service.ts` — add `checkAccess()` |
| MODIFY | `src/modules/scenario/services/scenario-access.service.spec.ts` — cover new method |
| MODIFY | `src/modules/scenario/scenarios.controller.ts` — add `@Get(':id')` handler |
| MODIFY | `src/modules/scenario/scenarios.module.ts` — register `ScenariosDetailService` |

All new files target <200 LoC. No migrations. No entity changes.

---

## 6. Implementation Considerations & Risks

- **Category relation load:** already present on `findAccessibleScenario`; keep `relations: ['category']` in `checkAccess`. Cost: one extra JOIN, negligible.
- **Language mismatch = 404, not 403:** intentional to avoid leaking scenario existence across languages.
- **`lockReason` enum:** string-literal union in DTO; document in Swagger via `@ApiPropertyOptional({ enum: ['premium_required'] })`. Future-proofs for `'language_not_enrolled'` etc. without breaking clients.
- **No rate limit:** user-driven tap flow; reuse of `findAccessibleScenario` in chat already unrated. If abused, add `@Throttle` later.
- **Cache:** deferred. Scenario data changes rarely, but access state is per-user-per-scenario. Revisit if traffic spikes.
- **Backward compatibility:** pure additive change — no existing client affected.

---

## 7. Success Criteria

- [ ] `GET /scenarios/:id` returns 200 with full DTO for FREE scenario.
- [ ] Returns 200 + `isLocked=true, lockReason='premium_required'` for PREMIUM scenario with non-subscribed user.
- [ ] Returns 200 + `isLocked=false` for PREMIUM scenario with active subscription OR explicit grant.
- [ ] Returns 404 for missing / unpublished / wrong-language scenario.
- [ ] Unit tests cover all 5 matrix rows.
- [ ] Swagger docs render `ScenarioDetailDto` schema.
- [ ] `npm run build` + `npm test` green.

---

## 8. Validation

- Unit tests in `scenarios-detail.service.spec.ts` for the 5 behavior-matrix rows.
- Unit tests in `scenario-access.service.spec.ts` for `checkAccess` edge cases (missing sub, expired sub, grant-only, free tier short-circuit).
- Manual: curl all 5 cases against `npm run start:dev`.

---

## 9. Next Steps

1. Invoke `/ck:plan` with this report as context → generate phase files under `plans/260421-1901-scenario-detail-api/`.
2. Implement phase 01 (DTO + access service refactor).
3. Implement phase 02 (detail service + controller + tests).
4. Run `tester` agent → `code-reviewer` agent.
5. Update `docs/api-documentation.md` with the new endpoint.

---

## 10. Unresolved Questions

_None. All design decisions locked:_

- ✅ `checkAccess` refactor over try/catch.
- ✅ No rate limit.
- ✅ Strict 404 on language mismatch (not soft-lock).
- ✅ No `type` field in response DTO.
