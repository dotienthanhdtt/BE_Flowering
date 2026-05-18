---
phase: 2
title: "Speech Module & WebSocket Gateway"
status: complete
priority: P1
effort: "6h"
dependencies: [1]
completedDate: "2026-05-18T11:27:00.000Z"
---

# Phase 2: Speech Module & WebSocket Gateway

## Overview
Create `src/modules/ai/speech/` housing the NestJS WebSocket gateway, the speech service, an in-memory PCM buffer, and a dual-mode auth guard (JWT for scenario, sessionId for onboarding). The gateway proxies PCM frames to Soniox and pushes partial/final JSON back to the client.

## Requirements
- Functional:
  - WS endpoint `/ws/speech/stt` accepting query: `traceId`, `lang`, `context` (`onboarding|scenario`), `sessionId` (onboarding only).
  - Auth: JWT for `scenario`, onboarding sessionId for `onboarding`. Reject unauthorized with close code 4401.
  - Max 1 active STT WS per principal. Second connect → close 4429.
  - Hard cap 3 min wall-clock per session → close 4408.
  - Client → server: binary PCM frames + text `{"type":"end"}`.
  - Server → client: `partial` / `final` / `session_end` / `error` JSON.
- Non-functional:
  - Use `@nestjs/platform-ws` raw `ws` adapter (NOT socket.io) for binary efficiency.
  - Backpressure: internal queue cap 2 s audio (≈64 KB at 16k mono); overflow → close 4413.
  - Heap cap per session = 3 min PCM ≈ 5.7 MB.

## Architecture
```
Mobile ──WS── SpeechGateway ──events──► SpeechService ──► SonioxSttProvider.openStream()
                                                │
                                                ├──► AudioPcmBuffer (RAM)
                                                └──► LangfuseTracingService (span open in phase 3)
```
Single `SpeechSession` object holds: principalId, traceId, language, context, sttHandle, pcmBuffer, startedAt, finalsText[].

## Related Code Files
- Create: `src/modules/ai/speech/speech.gateway.ts`
- Create: `src/modules/ai/speech/speech.service.ts`
- Create: `src/modules/ai/speech/audio-pcm-buffer.ts`
- Create: `src/modules/ai/speech/ws-auth.guard.ts`
- Create: `src/modules/ai/speech/dto/start-stt-session.dto.ts`
- Create: `src/modules/ai/speech/speech.types.ts` (SpeechSession, message shapes)
- Create: `src/modules/ai/speech/index.ts`
- Modify: `src/modules/ai/ai.module.ts` (register gateway, service, buffer)
- Modify: `src/main.ts` (enable WsAdapter: `app.useWebSocketAdapter(new WsAdapter(app))`)

## Implementation Steps
1. Install `@nestjs/platform-ws` if not present. Verify with `grep '@nestjs/platform-ws' package.json`.
2. Wire `WsAdapter` in `src/main.ts`.
3. Create `WsAuthGuard`:
   - Parse `context` + `sessionId`/Authorization from `client.upgradeReq` URL/headers.
   - `scenario` → verify JWT via existing `JwtService`, attach `userId`.
   - `onboarding` → validate sessionId against onboarding service in-memory store; attach `sessionId` as principalId.
   - Reject → call `client.close(4401)`.
4. Create `AudioPcmBuffer`:
   - `push(chunk: Buffer)` — append, increment byte counter, throw if `> MAX_BYTES`.
   - `toWav(): Buffer` — concatenate chunks, prepend 44-byte WAV header (PCM, 16 kHz, mono, 16-bit).
   - Constants: `SAMPLE_RATE=16000`, `BYTES_PER_SAMPLE=2`, `MAX_DURATION_SEC=180`, `MAX_BYTES=SAMPLE_RATE*BYTES_PER_SAMPLE*MAX_DURATION_SEC`.
5. Create `SpeechService`:
   - `startSession({principalId, traceId, language, context})` → opens Soniox stream, returns `SpeechSession`.
   - Wires provider callbacks → emits to caller via injected `onPartial/onFinal/onError/onClose` (or returns RxJS-like emitter; keep callbacks for KISS).
   - `pushAudio(session, chunk)` → buffer.push + provider.pushPcm.
   - `endSession(session)` → provider.end() → returns final transcript + (phase 3) audioUrl.
   - In-memory `Map<principalId, SpeechSession>` for concurrency guard.
6. Create `SpeechGateway`:
   - `@WebSocketGateway({ path: '/ws/speech/stt' })`
   - `handleConnection(client, req)`:
     - Run guard, parse query, check concurrency.
     - Call `speechService.startSession(...)`.
     - Wire provider events: on partial → `client.send(JSON.stringify({type:'partial',text}))`; final similar.
     - Start 3-min timer → on fire, send `{type:'error',code:'max_duration'}` and close 4408.
   - `handleMessage(client, data)`:
     - If `Buffer` → `speechService.pushAudio(session, data)`. Backpressure check.
     - If `string` JSON `{type:'end'}` → finalize.
   - `handleDisconnect(client)` — cleanup, abort if no `end` received (no archive — phase 3).
7. Add `START_STT_SESSION_DTO` for shape validation of query.
8. Register all in `AiModule`. `npm run build`.

## WS Message Shapes (server → client)
```ts
type ServerMsg =
  | {type:'partial', text:string}
  | {type:'final', text:string}
  | {type:'session_end', transcript:string, audioUrl:string|null, traceId:string}
  | {type:'error', code:'max_duration'|'overflow'|'provider'|'auth'|'concurrent', message:string};
```

## Success Criteria
- [x] `WsAdapter` enabled in main.ts
- [x] Gateway accepts connection with valid JWT (scenario) and with valid onboarding sessionId
- [x] Duplicate WS per principal closed with 4429
- [x] Binary frame forwarded to provider; partial/final messages received by client
- [x] `{type:'end'}` triggers final + `session_end` (audioUrl=null until phase 3)
- [x] 3-min hard cap closes session
- [x] Backpressure overflow closes with 4413
- [x] `npm run build` + `npm run lint` clean

## Risk Assessment
- Guard runs after upgrade in NestJS `ws` adapter → must close client manually; cannot pre-reject upgrade. Acceptable trade-off.
- Concurrency map = single-process. Multi-instance Railway deployment → second instance won't see first's session. Document as known limitation; sticky session not needed in v1.
- Memory pressure if all clients hit cap simultaneously → 5.7 MB × N. Monitor; alert if heap > 70%.
