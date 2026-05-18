---
phase: 1
title: Provider & Config
status: completed
priority: P2
effort: 3h
dependencies: []
---

# Phase 1: Provider & Config

## Overview

Add `TtsProvider` / `TtsStreamingProvider` interfaces and `SonioxTtsProvider` (REST `synthesize()` only — streaming lands in phase 3). Wire env config + module registration.

## Requirements
- REST: `POST https://tts-rt.soniox.com/tts` → binary mp3 bytes.
- Env-driven model/voice/format/sampleRate (defaults: `tts-rt-v1`, `Adrian`, `mp3`, `24000`).
- Reads `SONIOX_API_KEY` (existing). Throws `ServiceUnavailableException` if absent (mirrors STT provider pattern).

## Architecture
Interface `TtsProvider.synthesize(text, opts) → {audio: Buffer, mimeType}`. Implementation uses `globalThis.fetch` (Node 20+ native) — no new npm dep.

## Related Code Files
- Create: `src/modules/ai/providers/tts-provider.interface.ts`
- Create: `src/modules/ai/providers/soniox-tts.provider.ts`
- Modify: `src/config/app-configuration.ts` (add 4 keys under `ai` namespace)
- Modify: `.env.example` (add 4 vars)
- Modify: `src/modules/ai/ai.module.ts` (register `SonioxTtsProvider`)

## Implementation Steps
1. Define `TtsOptions`, `TtsResult`, `TtsProvider`, `TtsStreamHandle`, `TtsStreamingProvider` in `tts-provider.interface.ts`. Streaming types declared now; implementation in phase 3.
2. Implement `SonioxTtsProvider.synthesize()`:
   - Build body `{model, language?, voice, audio_format, text}`.
   - `fetch` with `Authorization: Bearer ${apiKey}`, `Content-Type: application/json`.
   - On non-2xx: throw `BadGatewayException` with status + truncated body (no API key in error).
   - Return `{audio: Buffer.from(await resp.arrayBuffer()), mimeType: 'audio/mpeg'}`.
3. Add `isAvailable()` → `!!apiKey`.
4. Add config keys + env vars (matches §4.6 of brainstorm).
5. Register provider in `ai.module.ts` providers array (no controller yet).
6. Run `npm run build`.

## Success Criteria
- [ ] `npm run build` passes.
- [ ] `SonioxTtsProvider.isAvailable()` returns true when env set.
- [ ] Manual smoke: `provider.synthesize('hello world')` returns Buffer with `audio/mpeg`.

## Risk Assessment
- **Soniox REST contract drift** — model name `tts-rt-v1` and voice `Adrian` taken from brainstorm; confirm via `curl` smoke before merging. Mitigation: env-driven, easy to flip.
