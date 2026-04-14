# Phase 05 — Flutter Client Migration

## Context Links

- Plan overview: `plan.md`
- **Separate git repo:** `/Users/tienthanh/Documents/ai_interview` is NOT this repo — Flutter lives at `/Users/tienthanh/Dev/new_flowering/app_flowering/flowering/` which has its own `.git`.
- Target file: `app_flowering/flowering/lib/features/chat/controllers/ai_chat_controller.dart`

## Overview

- **Priority:** P1 (blocks user-facing cutover)
- **Status:** pending
- **Brief:** Merge `_startSession()` + `_sendInitialChat()` in Flutter controller into a single `POST /onboarding/chat` call. Store `conversationId` from the first response.
- **Note:** DEFERRED — separate repository, requires coordinated mobile release. Backend implementation complete; Flutter migration scheduled for next mobile release cycle.

## Key Insights

- This is a cross-repo change — coordinate commit/deploy with backend.
- Backend has NO backward compat — Flutter must ship alongside backend change.
- Existing `sendMessage(message)` (subsequent turns) unchanged; only initial flow changes.
- Response envelope unchanged: `{code, message, data}`; `data` now uniform shape.

## Requirements

**Functional**
- First-time onboarding flow: send `{nativeLanguage, targetLanguage}` → get `conversationId` + first AI reply → render greeting.
- Subsequent turns: existing path with `conversationId` + `message`.
- Error handling: 400 (bad DTO), 404 (expired session), 429 (throttle) surface user-friendly messages.

**Non-functional**
- No Dart analyzer warnings.
- No orphan `_startSession` helper.

## Architecture

```
Before: onStart() → _startSession() → _sendInitialChat()   (2 round trips)
After:  onStart() → _chat(firstCall=true)                  (1 round trip)
        sendMessage(text) → _chat(firstCall=false)         (unchanged)
```

## Related Code Files

**Modify (Flutter repo)**
- `lib/features/chat/controllers/ai_chat_controller.dart`
- Possibly: `lib/features/chat/services/ai_chat_service.dart` (if API client layer separates)
- Possibly: DTO/request models under `lib/features/chat/models/`

**Read for context**
- Existing `_startSession` + `_sendInitialChat` implementations
- API base client + response-envelope unwrapping helper

## Implementation Steps

1. Locate and read `ai_chat_controller.dart` to confirm current method names.
2. Identify API client call for `/onboarding/start` and `/onboarding/chat` — likely in service layer.
3. In service layer:
   - Remove `startSession(nativeLang, targetLang)` method (or keep a thin wrapper if widely used — prefer remove).
   - Update chat method signature to accept optional `conversationId`, optional `message`, optional languages.
4. In controller:
   - Delete `_startSession()` + `_sendInitialChat()`.
   - Add single `_startChat()` that POSTs `{nativeLanguage, targetLanguage}`.
   - On response, store `conversationId` into controller state + append AI reply to message list.
   - `sendMessage(text)` unchanged except payload uses stored `conversationId`.
5. Update any fixtures / tests under `test/features/chat/`.
6. Run `flutter analyze` and `flutter test test/features/chat/`.
7. Manual smoke on simulator against local backend.

## Todo List

- [ ] Read current controller + service implementations
- [ ] Remove `_startSession` / start-session service method
- [ ] Implement unified `_startChat`
- [ ] Update `sendMessage` call site if needed
- [ ] Update tests + fixtures
- [ ] `flutter analyze` clean
- [ ] `flutter test` green
- [ ] Manual end-to-end onboarding on simulator

## Success Criteria

- Onboarding flow completes with single network call + subsequent chat turns.
- No references to `/onboarding/start` in Flutter codebase (`rg "/onboarding/start"` returns nothing).
- Release artifact ready to ship on same date as backend.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Flutter ships before backend (or vice versa) | Medium | High | Coordinate release tags; feature-flag if needed |
| Hive cache holds stale conversationId | Low | Medium | Clear onboarding cache on version bump |
| Retry logic double-creates sessions | Medium | Medium | Idempotency: if `conversationId` stored, use chat branch |

## Security Considerations

- Don't log `conversationId` in analytics beyond session scope.
- Handle 429 gracefully — avoid tight retry loops (respect throttler).

## Next Steps

- Coordinate merge with backend phase 03 deploy.
- Monitor crash reports + `/onboarding/chat` 4xx rate post-release.
