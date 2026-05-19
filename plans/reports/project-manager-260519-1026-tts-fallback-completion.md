# Project Manager Report: TTS Alibaba CosyVoice Fallback

**Date:** 2026-05-19T10:26Z  
**Plan ID:** 260519-0951-tts-alibaba-fallback  
**Status:** COMPLETED  

---

## Plan Status

| Phase | Task | Status |
|-------|------|--------|
| 1 | Config + scaffolding | Done |
| 2 | Alibaba CosyVoice provider | Done |
| 3 | Fallback decorator + DI rewire | Done |
| 4 | Tests + smoke validation | Done |

Plan frontmatter updated: `status: completed`. Phase table updated to all "Done".

---

## What Shipped

**Decorator-pattern fallback TTS:**
- `AlibabaTtsProvider` + `AlibabaTtsStreamHandle` — Alibaba DashScope WebSocket integration (cosyvoice-v3-flash, 24kHz mp3/pcm_s16le)
- `FallbackTtsProvider` + `FallbackTtsStreamHandle` — race state machine; triggers Alibaba on Soniox handshake loss OR no audio within 3s
- Per-stream winner attribution via `TtsResult.provider` field
- Interface update: `TtsStreamingProvider.openStream` now accepts `audioFormat` and `sampleRate`
- Langfuse observability: `tts.fallback_fired` / `tts.fallback_aborted` events; dual-emit log keys (soniox_* + tts_*)
- All 12 red-team findings honored: format gating, inactivity timeout, key sanitization, per-stream state, concurrent safety, DataInspection header toggle
- 52 new tests + 18 updated: 70/70 passing

**Build + Tests:**
- `npm run build` clean (no TS errors)
- `npx jest alibaba-tts fallback-tts soniox-tts tts.service.spec` — 70/70 passing

---

## Deferred to v2

- Persist `audioProvider` column on `ai_conversation_messages` for accurate cache_hit attribution
- Circuit breaker for sustained Alibaba/Soniox outages (currently every request pays 3s tax during outage)
- Per-request fallback override (e.g. `?fallback=false` for bisection)
- Remove dual-emit `soniox_*` log keys after dashboard migration (2-week window)

---

## Docs Updated

| Doc | Update |
|-----|--------|
| `system-architecture.md` | Added TTS section describing fallback layer + format/provider attribution |
| `codebase-summary.md` | Updated TTS surfaces section; listed all 3 new provider files + env vars |
| `project-changelog.md` | Added dated 2026-05-19 entry; summarized feature scope, observability, deferred items |

---

## Blockers & Risks

None. Plan executed cleanly. All success criteria met.

---

**Status:** DONE  
**Summary:** TTS Alibaba fallback fully implemented, tested (70 passing), documented. Soniox primary path unchanged; fallback triggers on connect-time failure per 3s deadline.
