---
phase: 3
title: "Flutter retry queue + reload rendering"
status: completed
priority: P2
effort: "1.5h"
dependencies: [2]
---

# Phase 3: Flutter retry queue + reload rendering

## Overview

Two small pieces:
1. **Retry queue** — Hive-backed queue stores failed PUT calls (network drop, 5xx). Drained on app resume + on next chat send.
2. **Reload rendering** — When user re-opens an existing conversation, `corrected_content` from the transcript response renders inline on user bubbles (matching the live-correction display path already built in `260310-chat-grammar-correction`).

## Requirements

### Functional
- Failed PUT → enqueue `{messageId, correctedText, attemptCount, lastTryAt}` to Hive box
- Drain queue on: app resume, next successful chat send, manual refresh
- Drop entries after 5 failed attempts OR after 24h (whichever first)
- Drop on 403/404 (won't succeed on retry)
- On conversation reload, user bubbles whose message has `corrected_content` render the correction (reuse existing widget from `260310-chat-grammar-correction`)

### Non-functional
- Queue operations <50ms (Hive is sync)
- Drain runs in background; no UI blocking
- Queue size capped at 100 entries (drop oldest if exceeded)

## Architecture

```
correction_persist_service.dart:
  putCorrectedContent(msgId, text):
    try → await PUT → done
    catch DioException:
      if (403 || 404) → drop, log
      else → enqueue to Hive box 'pending_corrections'

correction_retry_queue.dart:
  drain():
    for entry in box.values:
      if (attemptCount >= 5 || age > 24h) → delete entry
      else:
        try → PUT → delete entry on success
        catch → increment attemptCount, persist

  triggers:
    - app lifecycle resume (existing AppLifecycleListener)
    - successful chat send (in ai_chat_controller)

ai_chat_screen.dart:
  on conversation load, for each user message:
    if (message.correctedContent != null && message.correctedContent.isNotEmpty):
      render correction section (reuse UserMessageBubble correction widget)
```

The `corrected_content` field is already returned by `/scenario/chat` transcript (verified at `scenario-chat.service.ts:270`). Phase 3 just ensures the existing Flutter render path triggers from response data, not only from in-memory state set by the parallel correct call.

## Related Code Files

### Create
- `lib/features/chat/services/correction_retry_queue.dart` — Hive box wrapper + drain logic
- `lib/features/chat/models/pending_correction_model.dart` — Hive type adapter for `{messageId, correctedText, attemptCount, lastTryAt}`

### Modify
- `lib/features/chat/services/correction_persist_service.dart` (from Phase 2) — On error, enqueue instead of just logging
- `lib/features/chat/controllers/ai_chat_controller.dart` — Call `queue.drain()` after successful chat send
- `lib/features/chat/views/ai_chat_screen.dart` — Bind `correctedContent` from transcript to existing user-bubble correction widget on conversation reload
- `lib/features/chat/models/chat_message_model.dart` — If model doesn't already parse `corrected_content` from API response, add field + JSON parsing (verify against existing model)
- `lib/main.dart` (or wherever Hive boxes init) — Register `PendingCorrectionModel` adapter + open box

## Implementation Steps

1. **Hive model + adapter**:
   - Create `PendingCorrectionModel` with `@HiveType(typeId: <next-free-id>)`
   - Fields: `messageId` (String), `correctedText` (String?), `attemptCount` (int), `lastTryAtMs` (int)
   - Run `flutter pub run build_runner build --delete-conflicting-outputs`

2. **Queue service** — `correction_retry_queue.dart`:
   - `Box<PendingCorrectionModel>` opened in main.dart
   - `enqueue(messageId, correctedText)` — write entry (replace if exists with same messageId)
   - `drain()` — iterate, retry, prune
   - Drop conditions: `attemptCount >= 5`, `(now - lastTryAtMs) > 24h`, HTTP 403/404
   - Cap box size at 100 — on overflow, delete oldest by `lastTryAtMs`

3. **Update persist service** — On DioException, route to `queue.enqueue(messageId, correctedText)`.

4. **Controller drain trigger**:
   - In `ai_chat_controller.dart` after successful chat send, schedule `unawaited(_retryQueue.drain())`.
   - Add `WidgetsBindingObserver` for app resume → `drain()`. Or hook into existing app lifecycle observer if one exists.

5. **Verify model parses corrected_content** — Read `chat_message_model.dart`:
   - If field already exists (from `260310-chat-grammar-correction` plan): skip.
   - If not: add `correctedContent` (String?) parsed from `'corrected_content'` JSON key.

6. **Reload rendering**:
   - In `ai_chat_screen.dart` where user bubbles render, ensure correction widget reads from `message.correctedContent` (not only from in-memory cache set by parallel call).
   - Verify by closing + reopening conversation: previously corrected messages still show correction.

7. **Compile + test**:
   - `flutter analyze` zero errors
   - Manual: airplane mode → send message → reconnect → next chat send drains queue → DB has corrected_content
   - Manual: send message with correction → kill app → reopen conversation → correction visible

## Todo List

- [ ] Create `PendingCorrectionModel` Hive type
- [ ] Run build_runner for Hive adapter
- [ ] Register adapter + open box in `main.dart`
- [ ] Create `correction_retry_queue.dart` (enqueue, drain, prune)
- [ ] Update persist service to route errors to queue
- [ ] Trigger drain after chat send + on app resume
- [ ] Verify `chat_message_model.dart` parses `corrected_content`
- [ ] Ensure user bubble renders correction from `message.correctedContent` on reload
- [ ] Manual smoke: airplane-mode → enqueue → reconnect → drain works
- [ ] Manual smoke: kill + reopen → correction persists in UI
- [ ] `flutter analyze` zero errors

## Success Criteria

- [ ] Network failure on PUT → entry appears in Hive box
- [ ] Next chat send drains queue; entries succeed → removed from box
- [ ] 5 failed attempts → entry dropped, warning logged
- [ ] 24h-old entry pruned on next drain
- [ ] Conversation reload shows previously corrected messages with correction visible
- [ ] App resume triggers drain
- [ ] No UI freeze during queue operations

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Hive typeId collision with existing adapters | Med | Audit existing typeIds in repo, pick next free integer; document in model |
| Drain runs while user is mid-chat → race | Low | `unawaited` keeps it background; PUTs are idempotent so order doesn't matter |
| Queue grows unbounded on persistent offline | Med | Cap at 100 entries, drop oldest |
| `corrected_content` field missing from model → reload doesn't render | High if missed | Step 5 explicitly verifies; covered in todo list |
| Build_runner conflicts with other generated code | Low | `--delete-conflicting-outputs` flag handles it; standard Flutter pattern |

## Security Considerations

- Hive box stores only `{messageId, correctedText}` — no PII beyond what's already in user's local conversation cache
- No auth tokens stored in queue (PUT uses live JWT from interceptor at drain time)
