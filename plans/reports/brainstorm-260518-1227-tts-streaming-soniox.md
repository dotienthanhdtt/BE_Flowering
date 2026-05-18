# Brainstorm — TTS via Soniox (REST + WebSocket Streaming)

**Date:** 2026-05-18
**Status:** Approved design, ready for `/ck:plan`
**Related:** STT streaming (`plans/260518-1058-stt-streaming-soniox/`)

---

## 1. Problem Statement

Add Text-to-Speech to the platform so the AI tutor can speak its replies aloud. Pair-feature to the just-shipped STT streaming, completing the voice loop (user speaks → STT → LLM → TTS → user hears).

Use **Soniox TTS** (launched 2026-04-23, model `tts-rt-v1`) to keep one vendor for STT + TTS — same API key, same billing, same data residency.

Two delivery surfaces required:
- **REST one-shot**: mobile receives full mp3 URL after synthesis completes.
- **WebSocket streaming**: mobile receives mp3 audio chunks as Soniox generates them (lower time-to-first-audio for longer replies).

---

## 2. Requirements

### Functional
- Mobile sends only `messageId` — backend looks up `AiConversationMessage`, verifies ownership, synthesizes the `content`.
- Synthesize only `role === 'assistant'` messages (don't expose user-input synthesis).
- Both scenario (JWT-authenticated) and onboarding (sessionId-authenticated) contexts supported, mirroring chat endpoints.
- Reuse existing `traceId` from the conversation for Langfuse trace continuity.
- Persist the synthesized `audioUrl` on the `AiConversationMessage` row so re-tapping the same message does NOT re-synthesize (1-time-per-message cache via existing DB field).

### Non-functional
- Voice + audio format + model configurable via env (defaults: `Adrian`, `mp3`, `tts-rt-v1`).
- Soniox text limit: 5000 chars per request → reject longer messages with 4xx.
- Single Soniox API key reused (`SONIOX_API_KEY` already in `.env`).
- No new infra: reuse `ObjectStorageService`, `LangfuseService`, `WsAuthGuard`.

### Out of scope (YAGNI)
- Hash-based cross-message cache (DB-level per-message persistence is enough).
- Voice selection per scenario/user/language (single default).
- LLM-token-stream piping → TTS (different use case; current scope is pre-known text).
- Automatic synthesis on every chat reply (mobile triggers explicitly).
- SSML / phoneme control.
- Bucket TTL/cleanup job for synthesized audio (future ops concern).
- Audio format conversion / transcoding.

---

## 3. Approaches Evaluated

| # | Approach | Verdict |
|---|----------|---------|
| 1 | **REST only** (no WS) | Rejected by user. Simplest, ~90% of value. Mobile waits 500ms–2s for full mp3. |
| 2 | **REST + WS streaming** *(chosen)* | More effort. Lower time-to-first-audio for longer replies (~200ms vs ~1s). Matches STT pattern symmetrically. |
| 3 | **WS streaming only** | Rejected. REST is too useful for "tap-replay" flows and offline caching. |

| # | Trigger model | Verdict |
|---|---------------|---------|
| A | Auto-synthesize on every chat reply, return `audioUrl` in chat response | Rejected. Cost: pays even when user is muted. |
| B | Opt-in flag (`voiceEnabled: true`) in chat DTO | Rejected. Couples voice to chat lifecycle. |
| C | **Mobile-triggered via `messageId`** *(chosen)* | Decoupled, abuse-resistant, allows replay of any historical message. |

| # | Voice/format config | Verdict |
|---|---------------------|---------|
| α | Hardcoded constants in provider | Rejected. Requires code deploy to change voice. |
| β | **Env-driven config** *(chosen)* | Mirrors `sonioxModel` pattern from STT side. Free flexibility. |

---

## 4. Final Design

### 4.1 Provider Layer

**`src/modules/ai/providers/tts-provider.interface.ts`** *(new)*

```ts
export interface TtsOptions {
  voice?: string;
  language?: string;
  audioFormat?: 'mp3' | 'wav' | 'pcm_s16le';
  sampleRate?: number;
}

export interface TtsResult {
  audio: Buffer;
  mimeType: string;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(text: string, opts?: TtsOptions): Promise<TtsResult>;
  isAvailable(): boolean;
}

export interface TtsStreamHandle {
  start(text: string): void;                    // send full text once, then await chunks
  onAudio(cb: (chunk: Buffer) => void): void;
  onEnd(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
  forceClose(): void;
}

export interface TtsStreamingProvider extends TtsProvider {
  readonly supportsStreaming: true;
  openStream(opts: { language?: string; voice?: string; traceId: string }): TtsStreamHandle;
}
```

**`src/modules/ai/providers/soniox-tts.provider.ts`** *(new)*

- REST: `POST https://tts-rt.soniox.com/tts`
  - Body: `{ model, language, voice, audio_format, text }`
  - Header: `Authorization: Bearer <SONIOX_API_KEY>`
  - Response: binary audio bytes → return `{audio: Buffer, mimeType: 'audio/mpeg'}`.
- WS: `wss://tts-rt.soniox.com/tts-websocket`
  - On open send: `{api_key, model, language, voice, audio_format, sample_rate?, stream_id}`.
  - On `start(text)` send: `{text, text_end: true, stream_id}`.
  - On each server frame: decode base64 `audio` → emit via `onAudio`. On `audio_end: true` ignore; on `{terminated: true}` call `onEnd`.
  - On WS close / error → call `onError` and `onEnd`.
- Reads `SONIOX_API_KEY`, `SONIOX_TTS_MODEL`, `SONIOX_TTS_VOICE`, `SONIOX_TTS_AUDIO_FORMAT`, `SONIOX_TTS_SAMPLE_RATE` from `ConfigService`.

### 4.2 Service Layer

**`src/modules/ai/speech/tts.service.ts`** *(new)*

```ts
async synthesizeMessage(messageId: string, principal: TtsPrincipal): Promise<{audioUrl: string, mimeType: string, traceId?: string}>
```

Steps:
1. Load `AiConversationMessage` + its `AiConversation`.
2. If `message.audioUrl` already set → return it (free DB-cache).
3. Verify ownership:
   - `scenario`: `conversation.userId === principal.userId`.
   - `onboarding`: conversation matches `principal.sessionId` (mechanism: see §6 open question).
4. Reject if `role !== ASSISTANT` (`ForbiddenException`).
5. Reject if `content.length > 5000` (`BadRequestException`).
6. Call `soniox.synthesize(content)` → mp3 Buffer.
7. Upload via `objectStorage.uploadAudio(buffer, principalId, `${messageId}.mp3`)` → `signedUrl`.
8. Persist: `messageRepo.update(messageId, {audioUrl: signedUrl})`.
9. Record Langfuse event `tts.synthesize` (use conversation's traceId if stored, else messageId as sessionId).
10. Return `{audioUrl, mimeType: 'audio/mpeg'}`.

```ts
openStreamForMessage(messageId, principal, callbacks): TtsStreamSession
```

- Same steps 1–5 above (but if `audioUrl` exists, server fast-paths: emit one chunk = `download(audioUrl)` → call `onEnd`. KISS — avoids re-billing).
- Open Soniox WS stream → `start(text)` → pipe chunks to callbacks.
- On `onEnd`: best-effort concat chunks → upload → persist `audioUrl` (so future calls hit the cache).

### 4.3 REST Surface

**`src/modules/ai/speech/tts.controller.ts`** *(new)*

Two endpoints to mirror chat module split:

```
POST /ai/speech/tts                 (JWT-protected, scenario)
  body: { messageId: string }
  resp: { audioUrl, mimeType }

POST /ai/speech/tts/onboarding      (@Public, onboarding)
  body: { messageId: string, sessionId: string }
  resp: { audioUrl, mimeType }
```

Both wrap `TtsService.synthesizeMessage()` with different principal shapes.

### 4.4 WebSocket Surface

**`src/modules/ai/speech/tts.gateway.ts`** *(new)*

- Path: `/ws/speech/tts`.
- Query params identical to STT gateway: `?context=scenario&token=...&messageId=...` OR `?context=onboarding&sessionId=...&messageId=...`.
- Auth via existing `WsAuthGuard.validate(req)`.
- On connect:
  1. Validate auth.
  2. Read `messageId` query param.
  3. Call `tts.openStreamForMessage(messageId, principal, callbacks)`.
  4. Stream binary mp3 chunks to client as `ws.send(chunk, {binary: true})`.
  5. On end: send text frame `{type:'session_end'}` → close 1000.
- Errors mirror STT taxonomy:
  - `auth` → 4401
  - `not_found` → 4404
  - `forbidden` → 4403
  - `too_long` → 4413
  - `provider` → 4500
  - `max_duration` → 4408 (60s cap on TTS WS session)

### 4.5 Module Wiring

**`src/modules/ai/ai.module.ts`** — add to providers + exports:
- `SonioxTtsProvider`
- `TtsService`
- `TtsGateway`
- `TtsController` (added to `controllers` array)

Reuse: `WsAuthGuard`, `ObjectStorageService`, `LangfuseService` (all already registered).

### 4.6 Config

**`src/config/app-configuration.ts`** — add to `ai` namespace:

```ts
sonioxTtsModel: process.env.SONIOX_TTS_MODEL || 'tts-rt-v1',
sonioxTtsVoice: process.env.SONIOX_TTS_VOICE || 'Adrian',
sonioxTtsAudioFormat: process.env.SONIOX_TTS_AUDIO_FORMAT || 'mp3',
sonioxTtsSampleRate: parseInt(process.env.SONIOX_TTS_SAMPLE_RATE || '24000', 10),
```

**`.env.example`** — add:
```
SONIOX_TTS_MODEL=tts-rt-v1
SONIOX_TTS_VOICE=Adrian
SONIOX_TTS_AUDIO_FORMAT=mp3
SONIOX_TTS_SAMPLE_RATE=24000
```

### 4.7 Langfuse Tracing

- Event name: `tts.synthesize` (REST) and `tts.stream` (WS).
- Attributes: `{provider: 'soniox', voice, model, char_count, duration_ms, audio_bytes, message_id, audio_url}`.
- Use conversation's existing traceId (stored on conversation or messageId fallback) — keeps TTS tied to its originating LLM call in Langfuse.

---

## 5. Implementation Phases (suggested for `/ck:plan`)

| Phase | Scope | Est. effort |
|-------|-------|-------------|
| 1 | TTS provider interface + Soniox REST provider + env config | S |
| 2 | TTS service + REST controller (scenario + onboarding) + ownership check + DB-cache via `audioUrl` field | M |
| 3 | Soniox WS streaming in provider + TTS WS gateway + binary frame streaming | M |
| 4 | Langfuse events + docs (api-doc, codebase-summary, changelog) + journal | S |
| 5 | Tests (unit for provider, integration for service, e2e for controller, smoke for WS) | M |

---

## 6. Risks & Open Items

| # | Item | Severity | Resolution path |
|---|------|----------|-----------------|
| 1 | Onboarding ownership check — how does a `sessionId` map to a `conversationId`? `AiConversation` has `userId` (nullable) and `type` (ANONYMOUS/PERSONALIZE_INTAKE) but no obvious `sessionId` column. | **HIGH** | Investigate during planning. Likely either (a) stored in `metadata` JSON, (b) join table, or (c) the onboarding service already exposes `findConversationBySessionId`. If none exists → add a sessionId column or accept the security looseness of "any valid onboarding session can synthesize any onboarding-type message" (NOT acceptable). |
| 2 | WS streaming of mp3 — mobile player must be capable of decoding chunked mp3 mid-stream. Some players need full-file. Flutter `just_audio` supports streaming sources; verify. | MEDIUM | Confirm with mobile team. Fallback: switch WS audio format to `pcm_s16le` (raw frames are universally streamable). |
| 3 | Soniox WS protocol latency — first audio chunk arrival time on `tts-rt-v1` is undocumented. Could be ~500ms anyway, making WS advantage marginal vs REST. | LOW | Measure during phase 3. If <100ms gain, document and let mobile choose. |
| 4 | Audio bucket grows unbounded (each unique message = one mp3 forever). | LOW | Out of scope per YAGNI. Add lifecycle policy on Railway bucket later (e.g., delete `tts/*.mp3` older than 90 days). |
| 5 | DB-cache via `message.audioUrl` collides if the field is also used elsewhere (e.g., for user-uploaded voice attachments). | LOW | Grep usages during planning. If collision, namespace via `metadata.ttsAudioUrl` instead. |

---

## 7. Success Criteria

- `POST /ai/speech/tts` returns a playable mp3 URL within 2s for a typical 50-char message.
- Re-calling `POST /ai/speech/tts` with the same `messageId` returns the cached URL **without** calling Soniox (verified by Langfuse event count = 1, not 2).
- `wss:///ws/speech/tts?messageId=...` delivers the first audio chunk to the client within ~500ms (target).
- Ownership check rejects cross-user message synthesis (403).
- Messages > 5000 chars rejected (400) without contacting Soniox.
- Build passes (`npm run build`); unit + integration tests green.
- Langfuse trace shows TTS event under the same `sessionId` as the originating LLM call.

---

## 8. Next Steps

1. User approves this design.
2. Run `/ck:plan brainstorm-260518-1227-tts-streaming-soniox.md` to produce phased plan in `plans/260518-1227-tts-streaming-soniox/`.
3. Resolve Open Item #1 (onboarding ownership) during planning phase (scout `OnboardingService` + `AiConversation` usage).
4. Execute plan via `/ck:cook`.

---

## Unresolved Questions

- §6 #1 — onboarding `sessionId → conversationId` mapping mechanism (blocker for ownership check).
- §6 #2 — Flutter player streaming-mp3 support confirmation.
- §6 #5 — `AiConversationMessage.audioUrl` field current usage (may need namespacing).
