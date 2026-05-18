---
phase: 3
title: "Audio Archival & Langfuse Integration"
status: complete
priority: P1
effort: "3h"
dependencies: [2]
completedDate: "2026-05-18T11:27:00.000Z"
---

# Phase 3: Audio Archival & Langfuse Integration

## Overview
On session end, encode buffered PCM as WAV, upload to Railway bucket via `ObjectStorageService`, and expose the URL in the final WS message. Open a Langfuse span `stt.session` under the client-supplied `traceId` so downstream LLM calls join the same trace.

## Requirements
- Functional:
  - WAV upload path: `audio/stt/{principalId}/{traceId}.wav`, content-type `audio/wav`.
  - Returns signed URL in `session_end` message.
  - Langfuse span `stt.session` opened on `startSession`, closed on `endSession` or error.
  - Span metadata: `provider`, `language`, `context`, `duration_ms`, `audio_url`, `partial_count`, `transcript`.
  - On error/disconnect-without-end: do NOT upload audio; close span with `status=error`.
- Non-functional:
  - Upload must not block `session_end` message > 2 s — if upload slow, send `audioUrl:null` and update Langfuse asynchronously (best-effort).

## Architecture
```
endSession() ──► provider.end() ──► WAV encode ──► ObjectStorageService.upload (parallel)
                                                ├──► Langfuse span.update(audio_url)
                                                └──► WS send session_end{audioUrl}
```
Use `Promise.race([upload, sleep(2000)])` so we never starve the client.

## Related Code Files
- Modify: `src/modules/ai/speech/speech.service.ts` (archive + tracing)
- Modify: `src/modules/ai/speech/speech.gateway.ts` (pass audioUrl into session_end)
- Read for context: `src/database/object-storage.service.ts`
- Read for context: `src/modules/ai/services/langfuse-tracing.service.ts`

## Implementation Steps
1. Inject `ObjectStorageService` + `LangfuseTracingService` into `SpeechService`.
2. In `startSession`:
   - `const span = langfuse.startSpan({ traceId, name: 'stt.session', input: { language, context, provider: 'soniox' }, startTime: now })`.
   - Store span ref on `SpeechSession`.
3. In provider callbacks:
   - Count partials; accumulate finals into `session.finals: string[]`.
4. In `endSession(session)`:
   - `await provider.end()`.
   - `const wav = session.pcm.toWav()`.
   - `const key = \`audio/stt/${session.principalId}/${session.traceId}.wav\``.
   - Kick off upload promise (don't await yet): `const uploadP = storage.uploadAudio(wav, session.principalId, \`${session.traceId}.wav\`, 'audio/wav')`.
   - `const audioUrl = await Promise.race([uploadP, timeout(2000, null)])`.
   - Update span: `langfuse.endSpan(span, { output: { transcript: session.finals.join(' '), audio_url: audioUrl, partial_count, duration_ms } })`.
   - Return `{transcript, audioUrl}` to gateway.
   - If `audioUrl === null` (timed out), let `uploadP` settle in background, then `langfuse.updateSpan(span, {output: {audio_url}})` once known.
5. On WS abnormal close without `end`:
   - `langfuse.endSpan(span, { level: 'ERROR', statusMessage: 'client_disconnect' })`.
   - Skip upload.
6. Verify `ObjectStorageService.uploadAudio` signature handles WAV mime and the path layout. If signature requires extension, pass `${traceId}.wav`.

## Trace Continuity (Chat Side — wired in Phase 4)
Phase 3 only opens the STT span. Phase 4 ensures onboarding + scenario LLM calls reuse the same `traceId` so LLM completion span lands in the same Langfuse trace.

## Success Criteria
- [x] Audio uploaded to `audio/stt/{principalId}/{traceId}.wav` for every successful session
- [x] `session_end.audioUrl` present (or `null` if upload slow)
- [x] Langfuse trace shows `stt.session` span with metadata: provider, language, duration_ms, partial_count, audio_url, transcript
- [x] Client disconnect without `end` produces error span and no upload
- [x] `npm run build` clean

## Risk Assessment
- Bucket write fails (Railway outage) → `audioUrl:null`, span still completes; client behavior unaffected.
- `ObjectStorageService.uploadAudio` may not accept arbitrary content-type → verify; if not, extend or use lower-level put method.
- Langfuse latency on `endSpan` → fire-and-forget where safe (already standard in existing service).
