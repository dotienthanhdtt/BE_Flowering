---
phase: 1
title: "Provider Abstraction & Soniox Provider"
status: complete
priority: P1
effort: "4h"
dependencies: []
completedDate: "2026-05-18T11:27:00.000Z"
---

# Phase 1: Provider Abstraction & Soniox Provider

## Overview
Extend the STT provider abstraction with a streaming surface and add a Soniox provider that supports both sync REST and realtime WebSocket. Existing OpenAI/Gemini providers stay sync-only.

## Requirements
- Functional:
  - `SttStreamingProvider` interface that exposes a stream handle with `pushPcm`, `end`, and `onPartial/onFinal/onError/onClose` callbacks.
  - `SonioxSttProvider` implements both `SttProvider` (sync) and `SttStreamingProvider` (realtime WS).
  - Provider exposes `isAvailable()` based on `SONIOX_API_KEY` presence.
- Non-functional:
  - No regression for existing OpenAI/Gemini sync paths.
  - Provider does not couple to NestJS gateway internals (returns a transport-agnostic handle).

## Architecture
- `wss://stt-rt.soniox.com/transcribe-websocket` — single connection per session.
- First WS message: JSON config (api_key, model, audio_format=pcm_s16le, sample_rate=16000, num_channels=1, language).
- Subsequent: binary PCM frames forwarded as-is.
- Soniox emits incremental JSON token stream → provider buffers into partial/final boundaries (Soniox sends `is_final` per token group).
- Handle exposes Node `EventEmitter`-style callbacks (no RxJS) for KISS.

## Related Code Files
- Modify: `src/modules/ai/providers/stt-provider.interface.ts`
- Create: `src/modules/ai/providers/soniox-stt.provider.ts`
- Create: `src/modules/ai/providers/soniox-stt.provider.spec.ts`
- Modify: `src/modules/ai/ai.module.ts` (register provider)
- Modify: `src/config/app-configuration.ts` (if SONIOX_API_KEY / STT_STREAMING_PROVIDER not present)
- Modify: `.env.example` (add `SONIOX_API_KEY=`, `STT_STREAMING_PROVIDER=soniox`)
- Modify: `package.json` (ensure `ws` dep — `npm install ws @types/ws`)

## Implementation Steps
1. Add `ws` + `@types/ws` to package.json. Verify with `grep '"ws"' package.json` after install.
2. Extend `stt-provider.interface.ts`:
   ```ts
   export interface SttStreamHandle {
     pushPcm(chunk: Buffer): void;
     end(): Promise<void>;
     onPartial(cb: (text: string) => void): void;
     onFinal(cb: (text: string) => void): void;
     onError(cb: (err: Error) => void): void;
     onClose(cb: () => void): void;
   }
   export interface SttStreamingProvider extends SttProvider {
     readonly supportsStreaming: true;
     openStream(opts: { language?: string; traceId: string }): SttStreamHandle;
   }
   ```
3. Create `SonioxSttProvider`:
   - Inject `ConfigService`.
   - `transcribe(buf, mime, opts)` — calls Soniox file REST API (multipart) as fallback sync path.
   - `openStream(opts)` — opens `WebSocket(wss://stt-rt.soniox.com/transcribe-websocket)`, sends config JSON on `open`, returns handle.
   - Map Soniox token stream: emit `partial` while `is_final=false` (rolling text), emit `final` when `is_final=true` (commit segment text).
   - `pushPcm` — `ws.send(chunk, {binary:true})`. If WS not open, throw.
   - `end()` — send `{"type":"finalize"}` (per Soniox protocol), wait for last `final`, then close. Resolve.
   - On WS error/close, emit corresponding events.
4. Register `SonioxSttProvider` in `AiModule` providers + exports.
5. Add env vars to `.env.example` and `AppConfiguration`. Document in CLAUDE.md is not required; just configuration.
6. Run `npm run build` — must compile clean.

## Soniox Protocol Reference (verify on docs.soniox.com during impl)
- Config message keys: `api_key`, `model` (e.g. `stt-rt-preview` or current realtime model), `audio_format`, `sample_rate_hertz`, `num_channels`, `language_hints`.
- Response token shape: `{tokens: [{text, is_final, start_ms, end_ms, speaker?}]}`.

## Success Criteria
- [x] `ws` + `@types/ws` in package.json
- [x] `SttStreamingProvider` interface exported
- [x] `SonioxSttProvider` registered in `AiModule`
- [x] Unit test: mock ws server, verify config sent + frames forwarded + partials/finals emitted + close cleanup
- [x] `npm run build` passes
- [x] `npm run lint` clean for new files

## Risk Assessment
- Soniox API/model id drift → centralize model id in env var (`SONIOX_MODEL`) with sane default.
- WS leak if client never sends `end` → phase 2 gateway enforces idle + max-duration timeouts; provider exposes `forceClose()`.
- `@types/ws` mismatch with node version → install latest stable.
