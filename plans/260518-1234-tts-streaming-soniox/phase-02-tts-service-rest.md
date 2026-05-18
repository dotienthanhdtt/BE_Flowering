---
phase: 2
title: TTS Service & REST
status: completed
priority: P2
effort: 5h
dependencies:
  - 1
---

# Phase 2: TTS Service & REST

## Overview

`TtsService.synthesizeMessage()` with ownership check, 5000-char gate, DB cache via new `tts_audio_url` column. Two REST endpoints: scenario (JWT) + onboarding (public, with `conversationId`).

## Requirements
- Cache hit: return persisted `tts_audio_url` without calling Soniox (verifiable via Langfuse event count = 1 on second call).
- Assistant-role only (`ForbiddenException` otherwise).
- Length > 5000 → `BadRequestException` without contacting Soniox.
- Scenario ownership: `conversation.userId === principal.userId`.
- Onboarding ownership: `message.conversationId === body.conversationId` AND `conversation.type ∈ {ANONYMOUS, PERSONALIZE_INTAKE}` AND `conversation.userId IS NULL`.

## Architecture
```
TtsController (REST)
   ├─ POST /ai/speech/tts            [JWT]    body: {messageId}
   └─ POST /ai/speech/tts/onboarding [@Public] body: {messageId, conversationId, sessionId}
        └→ TtsService.synthesizeMessage(messageId, principal)
               1. load message (+conversation)
               2. cache check (message.ttsAudioUrl)
               3. ownership + role + length guards
               4. soniox.synthesize(content)
               5. storage.uploadAudio(buf, principalNs, `${messageId}.mp3`)
               6. persist tts_audio_url
               7. langfuse event 'tts.synthesize'
               8. return {audioUrl, mimeType}
```

## Related Code Files
- Create: `src/database/migrations/{timestamp}-add-tts-audio-url-to-ai-conversation-messages.ts`
- Modify: `src/database/entities/ai-conversation-message.entity.ts` (add `ttsAudioUrl?: string` column `tts_audio_url`)
- Create: `src/modules/ai/speech/tts.service.ts`
- Create: `src/modules/ai/speech/tts.controller.ts`
- Create: `src/modules/ai/speech/dto/tts-request.dto.ts` (scenario)
- Create: `src/modules/ai/speech/dto/tts-onboarding-request.dto.ts`
- Modify: `src/modules/ai/ai.module.ts` (register service, controller, repos)

## Implementation Steps
1. **Migration**: `ALTER TABLE ai_conversation_messages ADD COLUMN tts_audio_url TEXT NULL`. Reversible down. Run `npm run migration:run` locally.
2. **Entity**: add `@Column({ type: 'text', name: 'tts_audio_url', nullable: true }) ttsAudioUrl?: string`.
3. **DTOs**: class-validator — `messageId: UUID`; onboarding adds `conversationId: UUID, sessionId: UUID`.
4. **Service** (`tts.service.ts`):
   - Inject `SonioxTtsProvider`, `ObjectStorageService`, `LangfuseService`, message repo, conversation repo.
   - Define `TtsPrincipal = {kind:'scenario', userId} | {kind:'onboarding', sessionId, conversationId}`.
   - `synthesizeMessage(messageId, principal)`:
     - Load message with relation to conversation (single query).
     - If `message.ttsAudioUrl` → return early, record `tts.cache_hit` event.
     - Validate ownership per principal kind (throw 403 on mismatch).
     - Validate `role === ASSISTANT` (403).
     - Validate `content.length <= 5000` (400).
     - Call `soniox.synthesize(content)`.
     - Upload via `storage.uploadAudio(buf, principalNs, \`tts/${messageId}.mp3\`)` where `principalNs = userId || \`onboarding:${sessionId}\``.
     - `messageRepo.update(messageId, {ttsAudioUrl: signedUrl})`.
     - Record langfuse event `tts.synthesize` with `{provider, voice, model, char_count, audio_bytes, message_id}`.
     - Return `{audioUrl: signedUrl, mimeType: 'audio/mpeg'}`.
5. **Controller**: two endpoints; both wrap service. Scenario reads `req.user.sub`; onboarding passes DTO fields. Use `@Public()` on onboarding.
6. Wire in `ai.module.ts`. Add `TypeOrmModule.forFeature([AiConversationMessage, AiConversation])` if not already.
7. `npm run build` — verify entity + repo registration (see CLAUDE.md railway rule about dual-registration).

## Success Criteria
- [ ] Migration applies + reverts cleanly.
- [ ] Build passes.
- [ ] Manual: scenario `POST /ai/speech/tts {messageId}` returns playable mp3 URL.
- [ ] Manual: same request again returns same URL without Soniox call (cache hit).
- [ ] Manual: foreign-user messageId → 403.
- [ ] Manual: 5001-char message → 400.

## Risk Assessment
- **Migration order** — STT plan just shipped; ensure timestamp is later than any pending migrations. Use `npm run migration:generate` if possible.
- **Signed URL expiry** — `getSignedUrl` defaults 1h. Mobile may replay later. Cache-hit returns stale 403 once expired.

## Open Items
- Should cache-hit re-sign the URL (call `storage.getSignedUrl(storedPath)`) or trust stored URL? Recommend re-sign on read to be safe; store the object **path**, not the signed URL.
