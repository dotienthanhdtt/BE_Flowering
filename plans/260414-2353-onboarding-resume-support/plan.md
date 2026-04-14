title: "Onboarding Resume Support — GET messages + idempotent complete"
description: "Add GET /onboarding/conversations/:id/messages and make POST /onboarding/complete idempotent by caching extracted_profile + scenarios on ai_conversations."
status: completed
priority: P1
effort: 4h
branch: dev
tags: [backend, onboarding, api, idempotency, mobile-blocker]
created: 2026-04-14
completed: 2026-04-15
blockedBy: []
blocks: []
---

# Onboarding Resume Support

## Goal

Unblock mobile onboarding resume UX with two backend changes:

1. **New endpoint** `GET /onboarding/conversations/:conversationId/messages` → rehydrate chat UI on resume.
2. **Idempotent `POST /onboarding/complete`** → cache `extracted_profile` + `scenarios` on `ai_conversations`; second call returns cached data without LLM burn, same scenario UUIDs.

## API Conventions

- Wire format: `snake_case` (auto via `ResponseTransformInterceptor` → `toSnakeCase`). No `@Expose` needed on DTOs.
- TS properties camelCase, TypeORM column names snake_case via `@Column({ name: '...' })`.
- Response envelope `{ code, message, data }` applied by interceptor.

## Phases

| # | File | Blockers | Status |
|---|------|----------|--------|
| 01 | [DB migration + entity columns](phase-01-migration-and-entity.md) | — | completed |
| 02 | [Service methods (getMessages + idempotent complete)](phase-02-service-methods.md) | 01 | completed |
| 03 | [Controller GET endpoint + DTOs + Swagger](phase-03-controller-and-dto.md) | 02 | completed |
| 04 | [Unit + E2E tests](phase-04-tests.md) | 02, 03 | completed |
| 05 | [Docs update (api + changelog)](phase-05-docs.md) | 03 | completed |

## Dependency Graph

```
01 ─► 02 ─┬─► 03 ─┬─► 04
          │       └─► 05
          └─► 04
```

## Success Criteria

- `GET /onboarding/conversations/:id/messages` returns 200 w/ transcript for valid ANONYMOUS conv; 404 otherwise.
- `POST /onboarding/complete` called twice on same conv returns identical scenarios (same UUIDs) with second call not invoking LLM.
- Migration `up` + `down` runs cleanly in dev.
- All new + existing onboarding tests pass (`npm test -- onboarding`).
- `npm run build` passes.
- Swagger docs show both endpoints at `/api/docs`.

## File Ownership (no overlap)

- Phase 01: `src/database/migrations/{ts}-add-onboarding-cache-to-ai-conversations.ts` (NEW), `src/database/entities/ai-conversation.entity.ts`
- Phase 02: `src/modules/onboarding/onboarding.service.ts`
- Phase 03: `src/modules/onboarding/onboarding.controller.ts`, `src/modules/onboarding/dto/onboarding-messages-response.dto.ts` (NEW), `src/modules/onboarding/dto/index.ts`
- Phase 04: `src/modules/onboarding/onboarding.service.spec.ts`, `src/modules/onboarding/onboarding.controller.spec.ts`, `test/onboarding.e2e-spec.ts` (NEW or extend existing)
- Phase 05: `docs/api-documentation.md`, `docs/project-changelog.md`

## Rollback

Each phase is a single commit. Revert = undo phase.
- Phase 01 migration has a working `down()` that drops the 2 columns.
- No breaking API changes — new GET is additive; POST /complete is backward-compatible (same response shape).

## Non-Goals

- Server-side TTL / expiry logic (preserve current behavior).
- Delete-conversation endpoint.
- Pagination for messages (≤21 messages/conv, single response fine).
- Endpoint 3 from spec (session metadata GET) — redundant w/ Endpoint 1.

## Unresolved Questions

1. **Partial cache semantics** — if `scenarios.length !== 5` (LLM failure fallback returns `[]`), should we cache the empty array? Decision: **No — cache only when profile is structured (not `{raw: ...}`) AND `scenarios.length === 5`**. Otherwise retry on next `/complete` call. Prevents mobile getting stuck with `[]` scenarios forever.
2. **Profile shape validation** — `parseExtraction` may return `{raw: response}` on JSON parse failure. Cache gate: only set `extracted_profile` when it has real keys (not `raw`). See phase-02.
3. **Scenarios full payload** — store full DTO shape (`id`, `title`, `description`, `icon`, `accentColor`) to guarantee UUID stability across resumes. Confirmed per spec recommendation.
