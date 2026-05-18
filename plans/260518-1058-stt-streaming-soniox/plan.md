---
title: "STT Streaming via Soniox"
description: "Realtime voice input via WebSocket: mobile → backend → Soniox → partial/final transcripts. Audio archived to Railway bucket. Single Langfuse trace across STT + LLM."
status: complete
priority: P2
branch: "dev"
tags: [stt, voice, soniox, websocket, langfuse]
blockedBy: []
blocks: []
created: "2026-05-18T04:00:20.034Z"
createdBy: "ck:plan"
source: skill
completedDate: "2026-05-18T11:27:00.000Z"
---

# STT Streaming via Soniox

## Overview

Add streaming speech-to-text to onboarding + scenario chat. Mobile streams raw PCM 16-bit 16 kHz mono frames over WebSocket to backend; backend proxies to Soniox realtime WS and streams partial/final transcripts back. Audio archived to Railway bucket on session end. Single Langfuse trace shared with downstream LLM call (and future TTS).

**Source brainstorm:** `plans/reports/brainstorm-260518-1058-stt-streaming-soniox.md`

## Scope (v1)
- STT only. TTS deferred; abstraction shape leaves room for it.
- Soniox first streaming provider. OpenAI/Gemini stay sync-only (existing).
- Client-mints trace UUID; reused for STT span + LLM span.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Provider Abstraction & Soniox Provider](./phase-01-provider-abstraction-soniox-provider.md) | Complete |
| 2 | [Speech Module & WebSocket Gateway](./phase-02-speech-module-websocket-gateway.md) | Complete |
| 3 | [Audio Archival & Langfuse Integration](./phase-03-audio-archival-langfuse-integration.md) | Complete |
| 4 | [Chat Integration (Onboarding + Scenario)](./phase-04-chat-integration-onboarding-scenario.md) | Complete |
| 5 | [Tests & Docs](./phase-05-tests-docs.md) | Complete |

## Key Dependencies
- `ws` + `@nestjs/platform-ws` npm packages (verify before phase 2).
- ENV: `SONIOX_API_KEY`, `STT_STREAMING_PROVIDER=soniox`.
- Existing: `ObjectStorageService` (Railway bucket), `LangfuseTracingService`.

## Out of Scope
TTS, Opus transcoding, mid-session resume, multi-provider streaming fallback, on-device VAD.
