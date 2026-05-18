---
title: TTS Streaming via Soniox
description: >-
  Text-to-Speech via Soniox tts-rt-v1 — REST one-shot + WebSocket streaming.
  Completes the voice loop (STT → LLM → TTS). Mobile triggers via messageId;
  per-message DB cache on new tts_audio_url column.
status: completed
priority: P2
branch: dev
tags:
  - tts
  - voice
  - soniox
  - websocket
  - langfuse
blockedBy: []
blocks: []
created: '2026-05-18T05:36:26.448Z'
createdBy: 'ck:plan'
source: skill
---

# TTS Streaming via Soniox

## Overview

Pair-feature to STT streaming. Mobile sends `messageId` (+ `conversationId` for onboarding) → backend looks up assistant message → synthesizes via Soniox `tts-rt-v1` → returns mp3 URL (REST) or streams binary chunks (WS). Synthesized audio persisted to `tts_audio_url` column for 1-time-per-message cache.

**Source brainstorm:** `plans/reports/brainstorm-260518-1227-tts-streaming-soniox.md`

## Scope (v1)
- Soniox-only. REST + WS streaming surfaces. Scenario (JWT) + Onboarding (sessionId+conversationId) contexts.
- Voice/format/model env-driven (defaults: Adrian, mp3, tts-rt-v1).
- Assistant-role messages only. 5000-char cap.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Provider & Config](./phase-01-provider-config.md) | Completed |
| 2 | [TTS Service & REST](./phase-02-tts-service-rest.md) | Completed |
| 3 | [WebSocket Streaming](./phase-03-websocket-streaming.md) | Completed |
| 4 | [Langfuse & Docs](./phase-04-langfuse-docs.md) | Completed |
| 5 | [Tests](./phase-05-tests.md) | Completed |

## Key Dependencies
- Existing: `ObjectStorageService`, `LangfuseService`, `WsAuthGuard`, `SONIOX_API_KEY`.
- New env: `SONIOX_TTS_MODEL`, `SONIOX_TTS_VOICE`, `SONIOX_TTS_AUDIO_FORMAT`, `SONIOX_TTS_SAMPLE_RATE`.
- New DB column: `ai_conversation_messages.tts_audio_url` (migration).

## Out of Scope (YAGNI)
Cross-message hash cache, per-user voice selection, SSML, bucket TTL, audio transcoding, LLM-token-stream piping into TTS.

## Open Questions Resolved (vs brainstorm §6)
- **#1 Onboarding ownership** → Endpoints require `conversationId`; verify message↔conversation match AND `conversation.type ∈ {ANONYMOUS, PERSONALIZE_INTAKE}` AND `userId IS NULL`. Mobile already holds `conversationId` from chat flow.
- **#5 audioUrl collision** → STT already writes user-recorded audio to `message.audioUrl`. TTS gets its own column `tts_audio_url` via migration. No namespace tricks.
- **#2 Flutter mp3 streaming** → Confirm with mobile team during phase 3; fallback path documented (switch WS to `pcm_s16le`).
- **#3 WS latency** → Measure during phase 3 smoke test.
