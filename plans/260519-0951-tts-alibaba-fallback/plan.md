---
title: "TTS Alibaba CosyVoice fallback for Soniox"
description: "Decorator-pattern fallback provider: Soniox primary, Alibaba CosyVoice secondary, 3s first-audio deadline. Covers streaming WS + synthesize() paths."
status: completed
priority: P2
branch: "dev"
tags: ["tts", "fallback", "provider", "alibaba", "soniox"]
blockedBy: []
blocks: []
created: "2026-05-19T03:03:39.326Z"
createdBy: "ck:plan"
source: skill
---

# TTS Alibaba CosyVoice fallback for Soniox

## Overview

Add Alibaba CosyVoice as automatic fallback for Soniox realtime TTS when Soniox fails at connect-time (handshake error OR no audio within 3s). Both streaming WebSocket path (`openStream`) and non-streaming path (`synthesize`) fall back. Cache uses first-writer-wins (no provider tag in cache key). Voice mismatch acceptable (`Adrian` → `longanyang`).

Implementation = **decorator pattern**: new `FallbackTtsProvider` wraps `SonioxTtsProvider` + new `AlibabaTtsProvider`. Service + gateway swap their concrete-type injection from `SonioxTtsProvider` → `FallbackTtsProvider` (same shape, no behavior change for caller). Observability via `tts.fallback_fired` event.

## Context

- **Brainstorm:** `plans/reports/brainstorm-260519-0951-tts-alibaba-fallback.md`
- **Research:** `plans/reports/research-260519-0944-alibaba-realtime-tts-migration.md`
- **Current provider:** `src/modules/ai/providers/soniox-tts.provider.ts`
- **Interface:** `src/modules/ai/providers/tts-provider.interface.ts` (unchanged)
- **Consumers:** `src/modules/ai/speech/tts.service.ts`, `src/modules/ai/speech/tts.gateway.ts`

## Locked decisions

| # | Decision |
|---|---|
| 1 | Trigger: connect-time only (handshake err OR no audio in 3s) |
| 2 | Voice mismatch OK — single default CosyVoice voice |
| 3 | Both streaming + non-streaming fall back |
| 4 | 3s aggressive deadline |
| 5 | Cache: single key, first-writer-wins |
| 6 | Region: Singapore only (`dashscope-intl.aliyuncs.com`) |
| 7 | Model: `cosyvoice-v3-flash`, voice `longanyang`, `mp3 @ 24000` (matches Soniox) |
| 8 | Skip: Qwen-TTS, voice cloning, pricing analysis |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Config and scaffolding](./phase-01-config-and-scaffolding.md) | Done |
| 2 | [Alibaba CosyVoice provider](./phase-02-alibaba-cosyvoice-provider.md) | Done |
| 3 | [Fallback decorator and DI rewire](./phase-03-fallback-decorator-and-di-rewire.md) | Done |
| 4 | [Tests and smoke validation](./phase-04-tests-and-smoke-validation.md) | Done |

## Dependencies

None — no overlapping unfinished plans. Soniox provider stays in tree as primary.

## Success criteria

- [x] Stream path: Soniox loss within 3s → seamless Alibaba audio to client; `tts.fallback_fired` logged.
- [x] Synthesize path: Soniox throw/timeout → Alibaba buffer returned.
- [x] Soniox happy path unchanged: no extra latency, no Alibaba calls.
- [x] `npm run build` clean.
- [x] All existing tests pass + new Alibaba/Fallback provider tests pass.
- [x] Smoke test on dev: temporarily break Soniox key → audio still plays.

## Red Team Review

### Session — 2026-05-19
**Findings:** 14 deduped (from 23 raw, 3 reviewers) — **12 accepted, 2 rejected**
**Severity breakdown:** 1 Critical, 6 High, 7 Medium
**Evidence filter:** All 14 findings cited file:line — none auto-rejected.

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| A | WAV format incompatibility — gateway requests `pcm_s16le`, plan locked Alibaba to mp3 → corrupt audio + poisoned cache when Alibaba wins WAV race | Critical | **Accept** — plumb opts.audioFormat through Alibaba; support pcm_s16le @ 24kHz | Phase 2, Phase 3 |
| B | `SonioxTtsProvider.openStream` throws synchronously when key missing (soniox-tts.provider.ts:257); wrapper constructor unprotected → race never starts | High | **Accept** — try/catch in wrapper constructor; immediate promotion on throw | Phase 3 |
| C | `_lastWinner` singleton shared across concurrent streams; `tts.cache_hit` reports stale `provider:soniox` for Alibaba-produced cached bytes | High | **Accept** — per-stream `getWinnerProvider()`; cache_hit emits `provider:'cache'` | Phase 3 |
| D | `onOpen` ordering undefined — gateway's connect-time metric fires from `handle.onOpen` before race settles | High | **Accept** — onOpen fires exactly once on winner determination | Phase 3 |
| E | `forceClose()` racing 3s timer leaks secondary WS + DashScope tokens | High | **Accept** — `if (forced \|\| winner) return` guard at top of promoteToSecondary; clearTimeout in forceClose | Phase 3 |
| F | `AlibabaTtsProvider.synthesize` direct path has no inner timeout — only race wrapper enforces 5s. Hung WS → FD leak | High | **Accept** — 15s inactivity timer inside AlibabaTtsStreamHandle covers synth+stream | Phase 1, Phase 2 |
| G | API key may leak into `error.message` from `task-failed` event or `ws` library error → Langfuse trace attribute | Medium | **Accept** — `sanitizeMessage()` scrubs `Bearer\s+\S+` + literal key before forwarding | Phase 2 |
| H | SSRF hardcode reminder — runtime assertion against URL prefix | Medium | **Reject** — YAGNI; gold-plating; Soniox has same pattern. Code-comment is enough | (none) |
| I | `X-DashScope-DataInspection: enable` opts into Alibaba content moderation review → GDPR / sub-processor disclosure concern | High | **Accept (modified)** — default OFF; new env `ALIBABA_DATA_INSPECTION_ENABLED` (default false); privacy policy precondition documented | Phase 1, Phase 2 |
| J | Double-send during fallback: Soniox already processed text by 3s mark → both providers billed + see PII | Medium | **Accept (modified)** — add `tts.fallback_fired` rate metric for alerting; runbook documented. No race redesign (would hurt happy path) | Phase 3 |
| K | `AppConfiguration` TypeScript interface not updated → typo'd env key silently returns undefined → silent Soniox-only mode in prod | Medium | **Accept** — interface update + startup health-check log | Phase 1 |
| L | No per-request kill switch / circuit breaker | Medium | **Reject** — brainstorm explicitly chose connect-time-only over circuit breaker. Re-evaluate after first incident | (none) |
| M | No concurrent-stream tests in Phase 4 | Medium | **Accept** — added concurrent-streams scenario | Phase 4 |
| N | `tts.service.spec.ts` mock duck-types silently after DI rewire | Medium | **Accept** — mandate explicit mock variable rename + wrapper-shape assertions | Phase 4 |
| Assumption-1 | `TtsStreamingProvider.openStream` interface missing `audioFormat`/`sampleRate` (Soniox widens locally; gateway already passes them) | High | **Accept** — interface update in Phase 3 step 0 | Phase 3 |
| Assumption-6 | Renaming `soniox_*` log keys silently breaks dashboards while RA claims it won't | Medium | **Accept** — dual-emit `soniox_*` + `tts_*` during 2-week deprecation window | Phase 3 |
| Assumption-7 | `tts.service.spec.ts` mock false-green risk (same as N) | Medium | **Accept** (consolidated with N) | Phase 4 |

### Whole-Plan Consistency Sweep

After applying findings:

- ✅ Phase 1 interface update [RT-K] reconciled with Phase 2's `ConfigService.get()` usage.
- ✅ Phase 2's `supportsFormat()` API surfaced in Phase 3's pre-promotion check [RT-A].
- ✅ Phase 2 normalizeFormat(`pcm_s16le` → `pcm`) reconciled with gateway's existing `audioFormat: 'pcm_s16le'` (gateway.ts:148).
- ✅ Phase 3 provider attribution rewrite [RT-C] consistent with Phase 4 spec assertions on `result.provider` and `cache_hit provider='cache'`.
- ✅ Phase 3 dual-emit log keys [RT-Assumption-6] explicit; Phase 4 spec updated to assert both key families.
- ✅ Phase 3's removal of `FallbackTtsProvider.name` getter [RT-C] consistent: Plan.md decisions still hold (only locked decisions were trigger/voice/scope — `name` API was implementation detail).
- ✅ `TtsResult` interface gains `provider` field (Phase 3 step 4 `tagProvider` helper) — minor breaking change to provider interface; documented.
- ✅ No stale references to "FallbackTtsProvider exposes same surface" claim remain in Plan.md — replaced by explicit per-stream attribution model.

**Unresolved contradictions: none.** Plan ready for `/ck:cook`.

### Open follow-ups for v2 (NOT in scope here)

- Persist `audioProvider` column on `ai_conversation_messages` for accurate cache_hit attribution.
- Circuit breaker for sustained Alibaba/Soniox outages (currently every request pays 3s tax during outage).
- Per-request fallback override (e.g. `?fallback=false` for bisection).
- Remove dual-emit `soniox_*` log keys after dashboard migration.
