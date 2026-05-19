---
phase: 1
title: "Config and scaffolding"
status: pending
priority: P2
effort: "1h"
dependencies: []
---

# Phase 1: Config and scaffolding

## Overview

Add DashScope API key and Alibaba TTS config keys. No new code logic yet — just env + config plumbing so Phase 2 has somewhere to read from.

## Requirements

- Functional: New config keys readable via `ConfigService.get('ai.dashscopeApiKey')` etc.
- Non-functional: Defaults match Soniox audio format (mp3 @ 24000 Hz) to keep cache layer + WAV header math valid.

## Architecture

Single file edit (`app-configuration.ts`) + `.env.example` documentation. No runtime behavior changes yet.

## Related Code Files

- Modify: `src/config/app-configuration.ts`
- Modify: `.env.example`

## Implementation Steps

1. **[RT-K]** Update the `AppConfiguration` TypeScript interface (app-configuration.ts:27-46) to include the new typed fields — not just the object literal. Without this, `ConfigService.get<AppConfiguration>('ai').dashscopeApiKey` returns `unknown`, and runtime typos return `undefined` silently → fallback degrades to Soniox-only with no compile-time alarm.

2. Add config keys + interface fields under existing `ai` namespace in `app-configuration.ts`:
   ```ts
   ai: {
     // ... existing keys ...
     dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
     alibabaTtsModel: process.env.ALIBABA_TTS_MODEL || 'cosyvoice-v3-flash',
     alibabaTtsVoice: process.env.ALIBABA_TTS_VOICE || 'longanyang',
     alibabaTtsFormat: process.env.ALIBABA_TTS_FORMAT || 'mp3',  // default format; per-request can override (e.g. pcm_s16le for ?format=wav)
     alibabaTtsSampleRate: Number(process.env.ALIBABA_TTS_SAMPLE_RATE) || 24000,
     // [RT-I] Data inspection (content moderation) is OPT-IN. Default off — sending assistant message content to Alibaba moderation
     // touches GDPR/sub-processor disclosure. Enable explicitly only if compliance requires.
     alibabaDataInspectionEnabled: process.env.ALIBABA_DATA_INSPECTION_ENABLED === 'true',
     // [RT-F] Hard ceiling for any single Alibaba WS session (synth + stream). Prevents hung-WS FD leak.
     alibabaInactivityTimeoutMs: Number(process.env.ALIBABA_INACTIVITY_TIMEOUT_MS) || 15000,
     ttsFallbackEnabled: process.env.TTS_FALLBACK_ENABLED !== 'false',
     ttsFallbackTimeoutMs: Number(process.env.TTS_FALLBACK_TIMEOUT_MS) || 3000,
   }
   ```

3. **[RT-K]** Add startup health-check log in `AlibabaTtsProvider` / `FallbackTtsProvider` constructor: if `ttsFallbackEnabled && !dashscopeApiKey` → `logger.error('TTS fallback enabled but DASHSCOPE_API_KEY missing — fallback inactive')`. Surfaces silent-misconfig at boot, not at first incident.

4. Append to `.env.example` with brief comments:
   ```
   # Alibaba DashScope (TTS fallback provider)
   DASHSCOPE_API_KEY=
   ALIBABA_TTS_MODEL=cosyvoice-v3-flash
   ALIBABA_TTS_VOICE=longanyang
   ALIBABA_TTS_FORMAT=mp3
   ALIBABA_TTS_SAMPLE_RATE=24000
   # Data inspection / content moderation — opt-in only (privacy + compliance concern)
   ALIBABA_DATA_INSPECTION_ENABLED=false
   # Hard ceiling per Alibaba WS session (synth + stream); prevents hung-WS resource leak
   ALIBABA_INACTIVITY_TIMEOUT_MS=15000
   TTS_FALLBACK_ENABLED=true
   TTS_FALLBACK_TIMEOUT_MS=3000
   ```

5. Run `npm run build` — confirm zero TS errors AND that the interface compiles (i.e. removing one of the new keys from the literal triggers a TS error).

## Success Criteria

- [ ] Config keys present in `app-configuration.ts` under `ai.*` (object literal).
- [ ] **[RT-K]** `AppConfiguration` TypeScript interface updated with new typed fields.
- [ ] **[RT-I]** `alibabaDataInspectionEnabled` defaults to `false`.
- [ ] **[RT-F]** `alibabaInactivityTimeoutMs` defaults to 15000.
- [ ] `.env.example` updated with all new keys + comments documenting privacy/timeout intent.
- [ ] **[RT-K]** Startup log fires when `ttsFallbackEnabled && !dashscopeApiKey`.
- [ ] `npm run build` passes; removing a literal key triggers TS error (interface enforcement).

## Risk Assessment

- Risk: Existing `ai` config object becomes large/cluttered. Mitigation: keep alphabetical grouping; if it grows past ~15 keys later, refactor into `ai.tts.*` sub-namespace (out of scope here).
- Risk: Production env on Railway lacks `DASHSCOPE_API_KEY`. Mitigation: Phase 3 wires `isAvailable()` check — provider degrades to Soniox-only with a startup warning log.
