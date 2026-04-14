# Code Review — Onboarding Resume Support

**Date:** 2026-04-14
**Scope:** `GET /onboarding/conversations/:id/messages` + idempotent `POST /onboarding/complete`
**Build:** passing | **Tests:** 33/33 passing
**Verdict:** **APPROVE_WITH_FIXES** (1 HIGH + 2 MEDIUM informational; no blockers)

## Scores

| Dimension | Score | Notes |
|---|---|---|
| Correctness | 9/10 | Cache gate is airtight. One minor turn-count divergence risk. |
| Security | 7/10 | UUID-as-capability is permanent (no TTL after session-expiry removal). PII leak surface per UUID. |
| Maintainability | 8/10 | Clean separation, good tests, `as any` cast documented. |
| Performance | 9/10 | Cache hit short-circuits both LLM + message query. No N+1. |

---

## CRITICAL — none

## HIGH

### H1. Anonymous transcript is now permanently retrievable by UUID
`findValidSession` accepts any `ANONYMOUS` conversation regardless of age. Prior commit `6a13ebb` removed session expiry. The new `GET /messages` makes full transcript content retrievable by anyone holding the UUID — forever. Combined with no deletion endpoint (see Non-Goals in plan), this is a capability-URL-without-expiry pattern.

**Risk**: UUID leaks via logs, client storage backups, analytics, or DB dumps become permanent PII-exposure vectors. Transcript content is user-provided (name, language goals, etc.).

**Recommendation (non-blocking for this PR)**:
- Add a soft TTL on the GET route: reject if `createdAt < now - 30d` (or whatever aligns with retention policy).
- Alternative: background job to null-out `messages.content` on conversations older than N days.
- Track in follow-up ticket — don't block this PR since expiry removal was an independent decision.

## MEDIUM

### M1. Turn-count drift if `increment` fails after `saveMessage` (pre-existing, surfaced by new endpoint)
`chat()` saves messages then calls `conversationRepo.increment('messageCount')` non-atomically. If the increment fails (DB blip) but saves succeeded, `messageCount` and actual row count diverge. `getMessages()` derives `turnNumber` from `messageCount`, so a resume would report a wrong turn. Not introduced by this PR, but the new endpoint exposes the inconsistency to mobile.

**Fix (optional)**: derive `turnNumber` from `rows.length` in `getMessages` instead — source-of-truth is the messages table.
```ts
const msgCount = rows.length;               // authoritative
const turnNumber = msgCount === 0 ? 0 : Math.floor((msgCount - 1) / 2) + 1;
```
Also sidesteps any stale entity caching on `conversation.messageCount`.

### M2. Concurrent `/complete` clobber window (acknowledged in plan)
Two parallel calls race: both pass cache check → both hit LLM → both `update()`. Second write overwrites the first's UUIDs. Plan accepts this (mobile is sequential). If desired, swap `update` to conditional SQL:
```sql
UPDATE ai_conversations SET ... WHERE id = $1 AND extracted_profile IS NULL
```
via `createQueryBuilder`, which makes first-writer-wins deterministic. Not required — documenting.

## LOW

### L1. Throttler path-param detection is positional
`hasConversationId = !!httpReq.body?.conversationId || !!httpReq.params?.conversationId` grants 30/hr to *any* future route under `/onboarding/*` that happens to name a path param `conversationId`. A route with a different param name (e.g. `:id`) silently falls back to the 5/hr creation budget. Add a guard comment or refactor to an explicit per-route policy map when more routes land.

### L2. Cached scenarios have no schema version
`scenarios` JSONB stores current `OnboardingScenarioDto` shape. Future shape changes (new field, rename) will serve stale rows via cache hit without migration. Add a `schemaVersion` key inside the JSONB payload, or version the column, before the next shape change.

### L3. `extractedProfile` truthiness check works but is subtle
`if (conversation.extractedProfile && ...)` — `{}` is truthy. Currently safe because the write-gate requires `Object.keys(profile).length > 0`, so `{}` never lands in the column. But a future refactor that loosens the write gate would silently break the read gate. Suggest `Object.keys(conversation.extractedProfile ?? {}).length > 0` for defense in depth.

### L4. `as any` cast on JSONB write
Acceptable given JSONB accepts any serializable JSON. The inline comment explains rationale. For stronger typing, define `type LearnerProfile = Record<string, unknown>` on the entity and drop `as any` from the service.

## NITPICK

- `onboarding.service.ts:125` — `conversation.extractedProfile as Record<string, unknown>` double-cast; the column type is already `Record<string, unknown> | null`, the cast is redundant.
- Controller test `'delegates to service.complete with DTO'` returns `{ nativeLanguage, level }` — doesn't include `scenarios` array. Not wrong, but inconsistent with real response shape; a minor test-as-documentation smell.
- `onboarding-messages-response.dto.ts` — `createdAt: Date` in a DTO that flows through `toSnakeCase` is fine (Date is passthrough) but Swagger `type: String, format: 'date-time'` declaration works; good.
- Migration timestamp `1776100000000` (= 2026-04-09) — fine, monotonically increasing relative to prior migrations. Double-check ordering vs latest migration in `src/database/migrations/` before merge.

## Positive Observations

- Cache gate logic is the right shape: gate on structured-profile AND full-5 scenarios. Prevents sticky-empty-state bug cleanly.
- `ParseUUIDPipe` on the path param — prevents injection attempts into the WHERE clause and enforces v4-shaped tokens.
- Throttler switch from `@Throttle` decorators to a centralized guard is clean; rationale in file docblock is excellent.
- Test coverage on the idempotency gate (3 scenarios: cache hit, write-on-success, no-write-on-failure) is thorough.
- Response DTO is correctly minimal — no leak of `metadata`, `audioUrl`, `translatedContent` from the entity.
- Migration has a working `down()` with `IF EXISTS`.

## Answers to Plan's Scrutiny Questions

1. **Cache gate** — correct and safe. Truthy-check on read is defensive; write gate is authoritative. No bypass path identified.
2. **Anonymous access** — UUID v4 (~122 bits) is sufficient entropy for capability-URL model. The `type: ANONYMOUS` filter prevents leaking authenticated user conversations. Main concern is no TTL (see H1).
3. **Throttler change** — 30/hr is reasonable for reads. Not exploitable for abuse beyond that budget. See L1 for future-proofing.
4. **`as any` cast** — acceptable. JSONB serialization safe for plain JSON-objects/arrays; no Dates in the profile/scenarios shape.
5. **Response DTO** — confirmed minimal, no leakage.
6. **Race on `/complete`** — accepted per plan, documented in M2.

## Unresolved Questions

1. Is there an existing retention policy for anonymous conversations (ties to H1)?
2. Migration timestamp ordering — is `1776100000000` strictly later than the most recent migration on `dev`?
3. Are mobile clients storing the conversation UUID in a location that survives app uninstall (restoring H1's risk surface)?
