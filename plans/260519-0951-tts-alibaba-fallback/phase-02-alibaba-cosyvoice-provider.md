---
phase: 2
title: "Alibaba CosyVoice provider"
status: pending
priority: P2
effort: "4h"
dependencies: [1]
---

# Phase 2: Alibaba CosyVoice provider

## Overview

Implement `AlibabaTtsProvider` (`TtsProvider` + `TtsStreamingProvider`). Both `synthesize()` and `openStream()` go through the same WebSocket protocol (CosyVoice has no REST). `synthesize()` is a single-shot wrapper that opens a WS, runs the full task lifecycle, concatenates binary frames, returns a Buffer.

## Requirements

- Functional:
  - `openStream({language, voice, traceId, audioFormat?, sampleRate?})` returns a `TtsStreamHandle` emitting binary audio chunks. **[RT-A]** `audioFormat` and `sampleRate` MUST be honored per-request (not just env defaults) — gateway requests `pcm_s16le @ 24kHz` for `?format=wav` clients; ignoring this corrupts the audio.
  - **[RT-A]** Format mapping: accept `mp3` | `wav` | `pcm` | `pcm_s16le` | `opus`. Map `pcm_s16le` → CosyVoice's `pcm` format with `sample_rate=24000` per run-task payload. Validate sample rate against CosyVoice's supported list (8k/16k/22050/24k/44.1k/48k).
  - `synthesize(text, opts)` returns `{audio: Buffer, mimeType}`.
  - `isAvailable()` returns true iff `DASHSCOPE_API_KEY` is set.
  - `name = 'alibaba-cosyvoice'`.
  - `defaultMimeType` getter returns mime for configured format.
  - **[RT-A]** Provider exposes `supportsFormat(fmt: string): boolean` for the Fallback wrapper's pre-promotion capability check.
- Non-functional:
  - Lifecycle: `run-task` → wait `task-started` → `continue-task(text)` → `finish-task` → wait `task-finished` → close.
  - Audio = binary WS frames; events = JSON.
  - `task_id` = UUID per stream, reused for all 3 instructions.
  - Headers: `Authorization: Bearer ${apiKey}`. **[RT-I]** `X-DashScope-DataInspection` header is CONDITIONAL — only sent when `alibabaDataInspectionEnabled=true` (default false). Default behavior = NO moderation (text not retained by Alibaba for review).
  - **[RT-F]** Inner overall-timeout (`alibabaInactivityTimeoutMs`, default 15s) applies to every WS session — `synthesize()` AND `openStream()`. Timer started on `connect()`, reset on each audio chunk OR `task-started` event, cleared on `task-finished`. Expiry → `forceClose()` + `errorCb(new Error('Alibaba TTS inactivity timeout'))`.
  - **[RT-G]** Error sanitization: before forwarding any error via `errorCb`, scrub `error.message` of `/Bearer\s+\S+/gi` and the literal `apiKey` value. Applies to `task-failed` events, WS `error` events, and inactivity-timeout errors.
  - `completed=true` only when `task-finished` event received (cache gating parity with Soniox).
  - File ≤200 lines (mirror Soniox structure).

## Architecture

Same shape as `soniox-tts.provider.ts`:
- Internal class `AlibabaTtsStreamHandle implements TtsStreamHandle`.
- Outer `@Injectable() AlibabaTtsProvider`.
- WS via `ws` package (already in deps).

### Protocol cheat sheet

```
WS connect (Authorization header; X-DashScope-DataInspection only if opt-in via env [RT-I])
  → run-task   (header.action='run-task', task_id=UUID, payload.model/voice/format/sample_rate, input={})
  ← event task-started
  → continue-task   (payload.input.text=...)
  ← binary audio frames
  ← event result-generated   (ignore)
  → finish-task   (payload.input={})
  ← binary audio frames
  ← event task-finished   → completedByProvider=true
WS close
```

Errors → event `task-failed` with `error_code`, `error_message`.

## Related Code Files

- Create: `src/modules/ai/providers/alibaba-tts.provider.ts`
- Read (reference): `src/modules/ai/providers/soniox-tts.provider.ts`, `tts-provider.interface.ts`

## Implementation Steps

1. `import { randomUUID } from 'crypto'`.
2. Constants:
   - `ALIBABA_WS_URL = 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference'`
   - `AUDIO_FORMAT_TO_MIME` (mp3→audio/mpeg, wav→audio/wav, pcm→audio/L16, pcm_s16le→audio/L16, opus→audio/opus).
   - **[RT-A]** `SUPPORTED_FORMATS = new Set(['mp3', 'wav', 'pcm', 'pcm_s16le', 'opus'])`.
   - **[RT-A]** `SUPPORTED_SAMPLE_RATES = new Set([8000, 16000, 22050, 24000, 44100, 48000])`.
   - **[RT-A]** Internal `normalizeFormat(fmt)` — maps `pcm_s16le` → `pcm` for run-task payload (CosyVoice accepts `pcm` for raw 16-bit signed PCM).
   - **[RT-G]** Internal `sanitizeMessage(msg, apiKey)` — strips `/Bearer\s+\S+/gi` and literal `apiKey` value; used on every error path.
3. `AlibabaTtsStreamHandle` class:
   - Constructor: `apiKey, model, voice, audioFormat, sampleRate, language, taskId, dataInspectionEnabled, inactivityTimeoutMs, logger`.
   - **[RT-A]** Constructor validates `audioFormat ∈ SUPPORTED_FORMATS` and `sampleRate ∈ SUPPORTED_SAMPLE_RATES`; throws clearly on mismatch BEFORE opening WS (caller — Fallback wrapper — must catch and skip promotion).
   - `connect()`:
     - **[RT-I]** Headers: always `Authorization: Bearer ${apiKey}`. Add `X-DashScope-DataInspection: enable` ONLY if `dataInspectionEnabled` is true.
     - **[RT-F]** Start inactivity timer (`setTimeout(forceCloseWithTimeout, inactivityTimeoutMs)`).
   - `ws.on('open')` → send `run-task` JSON with `parameters.format = normalizeFormat(audioFormat)`, `parameters.sample_rate = sampleRate`.
   - `ws.on('message', (data, isBinary))`:
     - **[RT-F]** Any message → reset inactivity timer.
     - `isBinary` → forward to `audioCb`, count chunks.
     - else parse JSON, switch on `header.event`:
       - `task-started` → `opened=true`, fire `openCb?.()`, flush pending: `sendText` + `sendFinish`.
       - `result-generated` → log debug only.
       - `task-finished` → `completedByProvider=true`, clear timer, `finish()`.
       - `task-failed` → **[RT-G]** `errorCb?.(new Error(sanitizeMessage(\`${code}: ${msg}\`, apiKey)))`, `finish()`.
   - `ws.on('error', err)` → **[RT-G]** wrap in `new Error(sanitizeMessage(err.message, apiKey))` before `errorCb`. `finish()`.
   - `ws.on('close')` → `finish()`.
   - **[RT-F]** `forceCloseWithTimeout()`: `errorCb(new Error('Alibaba TTS inactivity timeout'))`; `ws.terminate()`; `finish()`.
   - `start(text)`: if not opened → buffer in `pendingText`; else `sendText(text); sendFinish()`.
   - `sendText` → `continue-task`; `sendFinish` → `finish-task`.
   - `forceClose()` → clear timer; `ws.terminate(); finish()`.
   - `finish()` → idempotent; clears timer; calls `endCb(completedByProvider)`.
4. `@Injectable() AlibabaTtsProvider`:
   - Read config via `ConfigService` (incl. `alibabaDataInspectionEnabled`, `alibabaInactivityTimeoutMs`).
   - `isAvailable()` → `Boolean(apiKey)`.
   - **[RT-A]** `supportsFormat(fmt)` → `SUPPORTED_FORMATS.has(fmt)`.
   - `defaultMimeType`, `configuredSampleRate` getters (gateway needs both for WAV header math).
   - **[RT-F]** `synthesize(text, opts)`: wrap `openStream(opts)` in `new Promise`; accumulate chunks; resolve on `onEnd(true)`; reject on error / `completed=false`. Wrap whole thing in `finally { handle.forceClose() }` so resource always releases on reject. The handle's inner inactivity timer guarantees the promise settles within `inactivityTimeoutMs` even if Alibaba goes silent.
   - **[RT-A]** `openStream(opts)`: resolve per-request audioFormat/sampleRate (`opts.audioFormat ?? this.config.alibabaTtsFormat`); pass to `AlibabaTtsStreamHandle`. Constructor validates and may throw — caller must handle.
5. `npm run build` — zero TS errors.

## File size guard

Target ≤200 lines. If exceeded, extract `AlibabaTtsStreamHandle` to `alibaba-tts.stream-handle.ts`.

## Success Criteria

- [ ] File compiles, implements both interfaces; exposes `supportsFormat()`.
- [ ] `synthesize()` returns valid mp3 Buffer (manual smoke with real key).
- [ ] **[RT-A]** `synthesize()` and `openStream()` honor per-request `audioFormat='pcm_s16le'` and `sampleRate=24000` — verified by inspecting the run-task payload in spec.
- [ ] **[RT-A]** Constructor throws on unsupported format/sample-rate.
- [ ] **[RT-F]** Hung WS (no `task-started` for 15s) → `errorCb('inactivity timeout')` + WS terminated. Verified in spec with fake timers.
- [ ] **[RT-G]** Error messages never contain the apiKey value or any `Bearer <token>` substring — verified by spec.
- [ ] **[RT-I]** `X-DashScope-DataInspection` header absent unless `alibabaDataInspectionEnabled=true`.
- [ ] `openStream()` emits binary chunks then `onEnd(true)` on happy path.
- [ ] `completedByProvider=false` if WS closes before `task-finished`.
- [ ] `isAvailable()` false when key missing.

## Risk Assessment

- Binary-frame vs base64-in-JSON: explicit `isBinary` check in `on('message')`.
- `continue-task` before `task-started`: hard-gate `sendText` behind `opened` flag.
- Missing `finish-task` → consumer hangs: `start(text)` sends both `continue-task` + `finish-task` for single-shot.
- `task_id` mismatch: generate UUID once in constructor.
- WAV-header math expects 24kHz: provider exposes `configuredSampleRate` (gateway already reads this).
- **[RT-A]** CosyVoice format string — docs list `pcm` (raw signed 16-bit PCM). Plan normalizes `pcm_s16le` → `pcm`. If CosyVoice returns big-endian or different bit depth, gateway WAV header will produce wrong-sounding audio. Verify byte order with a smoke test before relying on WAV path.
- **[RT-F]** Inactivity timer interacts with chunked-audio streams that emit chunks at long intervals — 15s default is generous (CosyVoice TTFB <500ms; max sentence pause <2s). If false positives appear, raise via env.

## Security Considerations

- API key `private readonly`; never logged.
- **[RT-I]** `X-DashScope-DataInspection` is OPT-IN. Default off — sending assistant message content to Alibaba's content-moderation review touches GDPR + sub-processor disclosure. Privacy policy must list Alibaba before enabling. Documented as a separate env var (`ALIBABA_DATA_INSPECTION_ENABLED`).
- **[RT-G]** All error forwarding scrubs `Bearer\s+\S+` patterns and the literal key value via `sanitizeMessage()`. Spec asserts no key fragment ever appears in `err.message`.
- Hardcoded URL: `ALIBABA_WS_URL` is a module-level constant. Do not parameterize via env — see file header comment.
