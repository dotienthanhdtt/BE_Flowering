---
phase: 2
title: "Flutter wire PUT after parallel responses"
status: completed
priority: P2
effort: "1h"
dependencies: [1]
---

# Phase 2: Flutter wire PUT after parallel responses

## Overview

After both `/scenario/chat` and `/ai/chat/correct` resolve, fire `PUT /ai/messages/:realId/corrected-content` with the real messageId from the chat response and correctedText from the correct response. Existing parallel-call pattern preserved; only new call added.

## Requirements

### Functional
- PUT fires only after BOTH parallel responses resolve
- messageId source = newest USER message from chat response transcript
- correctedText source = `correctedText` field from correct response (may be null)
- Skip PUT if correct call errored (chat still works)
- Skip PUT if chat returned no new user message row (defensive)
- Fire-and-forget (don't block UI on PUT result)

### Non-functional
- Zero added latency to chat reply rendering
- PUT failure logged but does not surface as user-visible error

## Architecture

```
ChatController.send(text):
  futures = [
    apiClient.scenarioChat(text),         // existing
    apiClient.chatCorrect(text, prevAi),  // existing
  ]
  [chatRes, correctRes] = await Future.wait(futures, eagerError: false)

  // existing: render chat reply, render correction inline

  // NEW:
  realId = _extractNewUserMessageId(chatRes)
  if (realId != null && correctRes is not error):
    unawaited(apiClient.putCorrectedContent(realId, correctRes.correctedText))
```

Identifying "new user message" in transcript: pick the LAST `role=='user'` row from the chat response transcript that corresponds to this turn. The chat service appends user msg then assistant msg, so the last-but-one row is the user message just inserted.

## Related Code Files

### Create
- `lib/features/chat/services/correction_persist_service.dart` — Thin wrapper around Dio PUT call (or fold into existing api_service if pattern matches repo conventions)

### Modify
- `lib/core/constants/api_endpoints.dart` — Add `putMessageCorrectedContent(messageId)` builder
- `lib/features/chat/controllers/ai_chat_controller.dart` — After `Future.wait`, extract realId + fire PUT
- `lib/features/chat/services/ai_chat_service.dart` (or wherever Dio calls live) — Add `putCorrectedContent(messageId, correctedText)` method

## Implementation Steps

1. **Endpoint constant** — Add to `api_endpoints.dart`:
   ```dart
   static String putMessageCorrectedContent(String messageId) =>
     '/ai/messages/$messageId/corrected-content';
   ```

2. **Service method** — Add to chat service (or new `correction_persist_service.dart` if existing service is over 200 lines):
   ```dart
   Future<void> putCorrectedContent(String messageId, String? correctedText) async {
     try {
       await _dio.put(
         ApiEndpoints.putMessageCorrectedContent(messageId),
         data: { 'correctedText': correctedText },
       );
     } catch (e) {
       _logger.w('PUT corrected_content failed for $messageId: $e');
       rethrow; // let caller decide (Phase 3 will catch + enqueue)
     }
   }
   ```

3. **Controller wiring** — In `ai_chat_controller.dart` after the existing `Future.wait`:
   - Extract the new user message ID from the chat response (last user-role row in the returned transcript, or the row whose content matches the just-sent text — use the cleanest approach matching existing code).
   - Call `unawaited(_service.putCorrectedContent(realId, correctRes.correctedText))`.
   - Use `unawaited` (or equivalent) so chat UI render is not blocked.
   - Guard with `if (correctRes != null && realId != null)`.

4. **Compile check** — `flutter analyze` from `app_flowering/flowering/`. Zero errors.

5. **Manual smoke test**:
   - Send a chat message with grammar error → check Network tab: PUT fires after both chat + correct return
   - PUT returns 204
   - Reload conversation → corrected_content visible (Phase 3 wires the display path)

## Todo List

- [ ] Add endpoint constant
- [ ] Add `putCorrectedContent` service method
- [ ] Wire PUT call in controller after `Future.wait`
- [ ] Extract realId from chat transcript correctly (handle empty/missing edge case)
- [ ] Use `unawaited` to keep PUT non-blocking
- [ ] `flutter analyze` zero errors
- [ ] Smoke test: PUT fires, returns 204
- [ ] Verify chat UX unchanged (no added latency)

## Success Criteria

- [ ] On every user turn with grammar error, PUT fires with `{correctedText: "..."}` and real UUID
- [ ] On user turn without error, PUT fires with `{correctedText: null}`
- [ ] On correct API failure, PUT does not fire; chat unaffected
- [ ] On chat API failure, PUT does not fire (no realId to target)
- [ ] PUT latency never blocks bubble render

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Wrong realId extracted (off-by-one in transcript) | Med | Verify with manual test; use `where role=='user' && content==userInput` as fallback |
| `unawaited` swallows real errors silently | Med | Log warning in service `catch`; Phase 3 adds retry queue |
| Concurrent turns race the PUT | Low | Each PUT targets distinct messageId — no cross-turn races |
| Existing tests break | Low | New code is additive; existing parallel flow untouched |

## Security Considerations

- PUT uses existing JWT-authenticated Dio client (token attached via interceptor)
- No new client-side data persisted in Phase 2 (Phase 3 adds queue)
