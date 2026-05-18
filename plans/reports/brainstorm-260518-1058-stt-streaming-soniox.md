# Brainstorm — STT Streaming via Soniox (v1)

**Date:** 2026-05-18
**Scope:** STT only. TTS deferred; abstraction shape must allow TTS to share Langfuse trace later.
**Branch:** dev

## Problem Statement
Add voice input to chat (onboarding + scenario). Mobile streams mic audio to backend; backend proxies to Soniox realtime; partial + final transcripts stream back to mobile. Audio archived to Railway bucket. STT span shares a single Langfuse trace with the downstream LLM call (and future TTS).

## Decisions (locked)
| Topic | Decision |
|---|---|
| Mobile → backend audio | Raw PCM int16 16 kHz mono frames over WebSocket |
| Backend → mobile | WS text JSON: `partial` / `final` / `session_end` / `error` |
| STT provider v1 | Soniox realtime WS (sync REST path also implemented for parity) |
| Existing providers | OpenAI/Gemini stay sync-only, no streaming |
| Audio archival | Buffer PCM in memory, encode WAV once on session end, upload to Railway bucket |
| Max session | 3 min hard cap (≈5.7 MB PCM); reject beyond |
| Trace id | Client-mints UUID v4, passes to STT WS + chat REST; backend reuses as Langfuse traceId |
| Module location | `src/modules/ai/speech/` |
| TTS v1 | Deferred |

## Module Layout
```
src/modules/ai/
├── providers/
│   ├── stt-provider.interface.ts        # EXTEND: SttStreamingProvider + SttStreamHandle
│   ├── soniox-stt.provider.ts           # NEW: sync REST + streaming WS
│   ├── openai-stt.provider.ts           # unchanged
│   └── gemini-stt.provider.ts           # unchanged
├── speech/
│   ├── speech.gateway.ts                # NEW: @WebSocketGateway('/ws/speech/stt')
│   ├── speech.service.ts                # NEW: provider + archive + trace orchestration
│   ├── audio-pcm-buffer.ts              # NEW: PCM accumulator + WAV encoder
│   ├── ws-auth.guard.ts                 # NEW: JWT or onboarding sessionId
│   └── dto/start-stt-session.dto.ts
└── services/transcription.service.ts    # unchanged (file-upload REST path)
```

## WebSocket Protocol
```
Connect:  ws://.../ws/speech/stt?traceId=<uuid>&lang=en&context=onboarding|scenario&sessionId=<onboarding only>
C → S:    binary  PCM int16 LE 16kHz mono frames (~100 ms)
C → S:    text    {"type":"end"}
S → C:    text    {"type":"partial","text":"..."}
S → C:    text    {"type":"final","text":"..."}
S → C:    text    {"type":"session_end","transcript":"...","audioUrl":"...","traceId":"..."}
S → C:    text    {"type":"error","code":"...","message":"..."}
```

## Provider Abstraction
```ts
interface SttStreamingProvider extends SttProvider {
  supportsStreaming: true;
  openStream(opts: { language?: string; traceId: string }): SttStreamHandle;
}

interface SttStreamHandle {
  pushPcm(chunk: Buffer): void;
  end(): Promise<void>;
  onPartial(cb: (text: string) => void): void;
  onFinal(cb: (text: string) => void): void;
  onError(cb: (err: Error) => void): void;
  onClose(cb: () => void): void;
}
```
SonioxSttProvider implements both `SttProvider` (REST sync) and `SttStreamingProvider` (realtime WS at `wss://stt-rt.soniox.com/transcribe-websocket`).

## Langfuse — Single Trace
- Client UUID = Langfuse `traceId`.
- `SpeechService` opens span `stt.session` (provider, language, duration_ms, partial_count, audio_url, transcript).
- Onboarding + scenario chat DTOs accept optional `traceId`; LLM completion span reuses it.
- Resulting trace ordering: `stt.session` → `llm.completion` → (future) `tts.synthesis`.

## Audio Archive
- `AudioPcmBuffer` stores `Buffer[]`, tracks total bytes, hard-cap 3 min (5,760,000 bytes).
- On `session_end` success: prepend 44-byte WAV header → `ObjectStorageService.uploadAudio(wav, ownerId, ${traceId}.wav)`.
- Bucket path: `audio/stt/{userId|sessionId}/{traceId}.wav`.
- Failure or client disconnect mid-session: discard (no archive).

## Auth
- `WsAuthGuard`:
  - scenario context → JWT verify (existing pattern).
  - onboarding context → validate `sessionId` against onboarding session store.
- Per-user concurrency: max 1 active WS; reject duplicate with close code 4429.

## Approaches Evaluated
1. **Lazy REST + polling** — rejected: poor UX for voice input.
2. **SSE for results only** — rejected: STT needs bidirectional; SSE is one-way.
3. **WebSocket bidirectional (chosen)** — bidirectional binary + text, native fit for realtime STT.
4. **Opus client→server, transcode** — rejected v1: adds FFmpeg dep + CPU; PCM bandwidth (256 kbps) acceptable on mobile.
5. **Streaming on all providers** — rejected: YAGNI. Soniox only v1; OpenAI/Gemini remain sync.

## Risks
| Risk | Mitigation |
|---|---|
| Memory blow-up under concurrency | 3-min cap + 1 WS/user |
| Soniox disconnect mid-stream | Emit `error`, close client; no silent retry |
| Backpressure | Drop with `error: overflow` if queue > 2 s |
| Wrong NestJS WS adapter | Use `@nestjs/platform-ws` (raw ws), NOT socket.io |
| Onboarding has no JWT | Guard supports `sessionId` query param |
| WAV mime missing from REST allowlist | New path bypasses REST validators; uses storage service directly |
| Soniox cost runaway | Hard timeout 3 min; one-WS-per-user limit |

## Success Metrics
- p95 partial latency < 800 ms from frame send to partial received.
- 0 backend crashes under 50 concurrent STT sessions in load test.
- Langfuse view: single trace contains `stt.session` + `llm.completion` for ≥99% of voice messages.
- Audio archived for ≥99% of successful sessions.

## Next Steps / Dependencies
- ENV: `SONIOX_API_KEY`, `STT_PROVIDER_STREAMING=soniox`.
- Add `ws` + `@nestjs/platform-ws` deps (verify `package.json` before code).
- Confirm Railway bucket bucket name + path policy with current `ObjectStorageService`.
- Mobile contract doc: WS URL, query params, JSON message shapes, PCM framing.

## Out of Scope (v1)
TTS, Opus transcoding, mid-session resume, multi-provider streaming fallback, on-device VAD, transcript editing.

## Unresolved Questions
- Soniox model id per language — pick on impl (`en_v2_lowlatency` likely default).
- Audio retention policy in Railway bucket (TTL? user-delete?). Default v1: keep indefinitely, revisit when storage cost matters.
- Whether scenario STT should reuse the per-message `chatId` as trace id instead of a fresh UUID — defer to plan phase.
