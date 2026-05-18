---
phase: 3
title: WebSocket Streaming
status: completed
priority: P2
effort: 5h
dependencies:
  - 2
---

# Phase 3: WebSocket Streaming

## Overview

Soniox WS streaming in `SonioxTtsProvider.openStream()` + new `TtsGateway` at `/ws/speech/tts`. Binary mp3 chunks proxied to mobile. Reuses `WsAuthGuard`.

## Requirements
- Cache short-circuit: if `message.ttsAudioUrl` exists, fetch+stream once → close (avoid re-bill).
- First-audio target: <500ms after WS handshake.
- 60s max session duration cap.
- Error frame taxonomy aligned with STT: 4401 auth, 4403 forbidden, 4404 not_found, 4413 too_long, 4408 max_duration, 4500 provider.

## Architecture
```
mobile ──[WS /ws/speech/tts?context=...&messageId=...]──▶ TtsGateway
                                                              │
                                                       WsAuthGuard.validate
                                                              │
                                               TtsService.openStreamForMessage
                                                  (same auth/role/length guards as phase 2)
                                                              │
                                    ┌─cache hit─▶ stream stored mp3 from URL ──▶ end
                                    └─cache miss─▶ SonioxTtsProvider.openStream
                                                      │
                                          Soniox WS ──audio chunks──▶ ws.send(binary)
                                                      │
                                                  on end: concat → upload → persist ttsAudioUrl
```

## Related Code Files
- Modify: `src/modules/ai/providers/soniox-tts.provider.ts` (add `openStream()` per `TtsStreamingProvider`)
- Create: `src/modules/ai/speech/tts.gateway.ts`
- Modify: `src/modules/ai/speech/tts.service.ts` (add `openStreamForMessage()`)
- Modify: `src/modules/ai/ai.module.ts` (register gateway)
- Verify: `src/main.ts` WS path registration (compare to existing STT gateway wiring)

## Implementation Steps
1. **Provider WS** (`soniox-tts.provider.ts`):
   - `openStream(opts)`:
     - `new WebSocket('wss://tts-rt.soniox.com/tts-websocket')`.
     - On open send config: `{api_key, model, language, voice, audio_format, sample_rate, stream_id: traceId}`.
     - Expose `start(text)` → send `{text, text_end: true, stream_id}`.
     - On message: parse JSON; decode base64 `audio` → emit via `onAudio`. On `{terminated:true}` → `onEnd`.
     - On close/error → `onError` then `onEnd`.
     - `forceClose()` closes underlying WS.
2. **Gateway** (`tts.gateway.ts`):
   - Modeled on existing `speech.gateway.ts`. Path `/ws/speech/tts`.
   - On connection: `WsAuthGuard.validate(req)` → throw 4401 on fail; close.
   - Read `messageId` query param; build principal from auth context (`scenario` uses jwt.sub; `onboarding` requires `conversationId` query param too — mirror REST onboarding shape).
   - Call `tts.openStreamForMessage(messageId, principal, callbacks)`.
   - Callbacks: `onAudio(chunk) → ws.send(chunk, {binary:true})`; `onEnd → ws.send(JSON 'session_end') + ws.close(1000)`; `onError(e) → ws.close(closeCodeFor(e))`.
   - 60s `setTimeout` for max duration cap (close 4408).
3. **Service `openStreamForMessage`**:
   - Run same guards as phase 2 (load message, ownership, role, length).
   - If `message.ttsAudioUrl` → `fetch(url)` → emit body as one chunk → onEnd.
   - Else open provider stream; collect chunks in array; on end → concat → `storage.uploadAudio` → persist `ttsAudioUrl`. Best-effort (errors don't break stream).
4. Record langfuse events `tts.stream.start` / `tts.stream.end` with `{first_chunk_ms, total_chunks, total_bytes}`.
5. `npm run build`.

## Success Criteria
- [ ] Build passes.
- [ ] Manual smoke: mobile (or `wscat`) receives binary chunks, total bytes match REST output for same message.
- [ ] First chunk < 500ms on `tts-rt-v1` (measured + recorded in langfuse).
- [ ] Cache-miss WS run leaves `tts_audio_url` populated for next call.
- [ ] Auth failure closes with 4401; foreign messageId closes with 4403.

## Risk Assessment
- **Flutter `just_audio` streaming-mp3** — confirm with mobile team before merge. Fallback: env-flip `SONIOX_TTS_AUDIO_FORMAT=pcm_s16le`; service code unchanged.
- **WS path collision** — STT gateway already binds `/ws/speech/stt`. Verify registration order in `main.ts`.
- **First-chunk latency** — if Soniox WS first-audio ≥ REST latency, WS adds complexity for no gain. Measure in smoke; if marginal, mark WS deferred not rejected.
