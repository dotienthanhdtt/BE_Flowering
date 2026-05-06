# Phase 5 — Tests + Docs

**Status:** pending
**Priority:** high
**Effort:** M
**Depends on:** Phase 4

## Goal

Cover new behavior with unit + integration tests; update API docs and code-standards.

## Files

**Modified:**
- `src/modules/user/user.controller.spec.ts`
- `src/modules/user/user.service.spec.ts`
- `docs/api-documentation.md` (add POST `/users/me`, mark GET deprecated/removed)
- `docs/code-standards.md` (if response-shape conventions documented there)
- `docs/system-architecture.md` (mention telemetry table if architecture-level)

**New (optional):**
- `src/modules/user/services/device-event.service.spec.ts`

## Test Cases

### `DeviceEventService`
- ✅ `record()` inserts row with all fields mapped (device_model, clientTimestamp parses ISO, idfa, enable_noti).
- ✅ `record()` swallows DB errors (mock repo to throw → service resolves, logger.warn called).
- ✅ `idfa` undefined when DTO has `null`.

### `UserService.getMe`
- ✅ Returns shape `{profile, subscription}` for user with subscription.
- ✅ Returns `{FREE, ACTIVE, end_date: null}` when no subscription row.
- ✅ Maps each tier (FREE/TRIAL/PREMIUM/PREMIUM_PLUS) correctly.
- ✅ Maps each status (ACTIVE/EXPIRED/CANCELLED/PENDING) correctly.
- ✅ Maps legacy status=TRIAL → status=ACTIVE.
- ✅ `end_date` is ISO 8601 string when `currentPeriodEnd` set; null when not.
- ✅ Throws `NotFoundException` if user doesn't exist.

### `UserController` POST `/users/me`
- ✅ Calls `deviceEventService.record` then `userService.getMe`.
- ✅ Returns response from `getMe`.
- ✅ Telemetry recorded even if subscription read fails? — No, current spec: getMe failure still fails request (only telemetry write is fire-and-forget).
- ✅ Validates DTO: rejects missing `time_stamp`, missing `enable_noti`, malformed ISO date.

### `UserController` PATCH `/users/me`
- ✅ Returns new `MeResponseDto` shape after update.

## Doc updates

### `docs/api-documentation.md`

Replace `GET /users/me` section with `POST /users/me`:

```
### POST /users/me
Auth: Bearer JWT
Records device telemetry and returns profile + subscription.

Request body:
- platform     (enum "IOS" | "ANDROID", required)
- device_model (string, optional)
- time_stamp   (string, ISO 8601, required)
- time_zone    (string, IANA, optional)
- IDFA         (string|null, optional)
- enable_noti  (boolean, required)

Response data:
- profile: { display_name, email, avatar_url, native_language }
- subscription: { status, type, end_date }

Status enum: ACTIVE | EXPIRED | CANCELLED | PENDING
Type enum:   FREE | TRIAL | PREMIUM | PREMIUM_PLUS
```

Add migration note: `GET /users/me` removed in 2026-04-25 release. Mobile must POST.

### `docs/code-standards.md`

If it documents response-shape examples, refresh the `/users/me` example.

### `docs/project-changelog.md`

Add entry:
```
## 2026-04-25
- BREAKING: GET /users/me → POST /users/me with telemetry body
- Added user_device_events table (append-only)
- Added subscription.tier (FREE/TRIAL/PREMIUM/PREMIUM_PLUS)
- Added subscription status PENDING
```

## Todo

- [ ] Add unit tests for `DeviceEventService`
- [ ] Update `user.service.spec.ts` for new `getMe` + mappers
- [ ] Update `user.controller.spec.ts` for POST flow
- [ ] Update `docs/api-documentation.md`
- [ ] Update `docs/project-changelog.md`
- [ ] (Optional) `docs/system-architecture.md` mention
- [ ] `npm test` all green
- [ ] `npm run lint` clean
- [ ] `npm run build` clean

## Success Criteria

- All tests pass.
- Coverage of `user.service.ts` and `device-event.service.ts` ≥ 80%.
- Docs accurately describe new endpoint shape.
- `npm run build`, `npm test`, `npm run lint` all green.

## Risks

- **Test fixtures using old `UserProfileDto` shape** — search & update.
- **E2E tests** — if `/test` e2e suite hits `GET /users/me`, swap to POST.

## Done = ship

After Phase 5:
1. Coordinate mobile force-update.
2. Run migration on prod.
3. Deploy backend.
4. Verify Railway logs for `user_device_events` inserts.
5. Follow-up tasks: RevenueCat tier mapping, event-log retention/partitioning.
