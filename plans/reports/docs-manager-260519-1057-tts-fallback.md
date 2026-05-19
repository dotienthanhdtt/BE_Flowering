# Documentation Update: TTS Fallback Feature

**Date:** 2026-05-19  
**Feature:** Alibaba CosyVoice fallback for Soniox realtime TTS  

## Changes Made

### 1. **codebase-summary.md** (AI Module section, lines 104–109)
- Added 4 new provider files: `alibaba-tts.provider.ts`, `alibaba-tts.stream-handle.ts`, `fallback-tts.provider.ts`, `fallback-tts.stream-handle.ts`
- Documented fallback decorator architecture (Soniox primary → Alibaba secondary, 3s deadline)
- Added all new env vars: `DASHSCOPE_API_KEY`, `ALIBABA_*`, `ALIBABA_DATA_INSPECTION_ENABLED`, `ALIBABA_INACTIVITY_TIMEOUT_MS`, `TTS_FALLBACK_ENABLED`, `TTS_FALLBACK_TIMEOUT_MS`
- Added observability note: `tts.fallback_fired` / `tts.fallback_aborted` events + per-stream provider attribution
- **Delta:** +12 lines (expanded from single-line TTS mention to full stack)

### 2. **system-architecture.md** (TTS line 131)
- Expanded TTS blurb from single sentence to full paragraph
- Clarified decorator pattern, Soniox/Alibaba roles, 3s timeout, voice mismatch acceptance, cache first-writer-wins, event emission, deprecation window dual-logging
- **Delta:** +1 line expanded to +6 lines

### 3. **project-changelog.md** (new entry, 2026-05-19)
- Added comprehensive changelog entry with Added/Changed/Behavior sections
- Documented new providers, interfaces, env vars, observability signals
- Explained fallback trigger (handshake loss or 3s no-audio), happy path (no latency), cache behavior
- **Delta:** +32 lines (new section, pre-dated after previous 2026-05-18 entry)

### 4. **api-documentation.md** (3 surgical edits)
- Line 950: "Soniox was not called" → "TTS provider was not called"
- Line 958: "Soniox error" → "TTS provider error (primary or fallback)"
- Line 977: "Backend opens a Soniox TTS WebSocket" → "Backend opens a TTS WebSocket connection (Soniox primary, Alibaba fallback)"
- Line 1013: Close code 4500 "Provider (Soniox) error" → "TTS provider error (primary or fallback)"
- **Delta:** +4 lines of edits (provider-agnostic language, no functional change to API)

## Files Updated

| File | Section | Lines Added | Type |
|------|---------|-------------|------|
| `docs/codebase-summary.md` | AI Module → TTS | +12 | Enhancement |
| `docs/system-architecture.md` | AI Module Flow → TTS | +5 | Expansion |
| `docs/project-changelog.md` | 2026-05-19 entry | +32 | New entry |
| `docs/api-documentation.md` | TTS endpoints | +4 | Refinement |

**Total lines added:** 53 (all surgical, no restructuring)

## Verification

- All new files confirmed in codebase: `src/modules/ai/providers/{alibaba,fallback}-tts.*`
- Env var names verified from plan.md locked decisions
- Interface changes (`audioFormat?`, `sampleRate?`, `supportsFormat?()`, `TtsResult.provider?`) cross-referenced with phase-03
- No stale references to "Soniox only" remain in public-facing docs
- Cache attribution updated: `provider: 'cache'` per plan red-team finding C

## Notes

- Skipped `code-standards.md` — FallbackTtsProvider is internal infra, not a public pattern for developers
- Skipped new `.md` file creation — feature is internal, already surfaced in relevant sections
- API endpoint contract unchanged (request/response schema stable); docs clarified provider abstraction only
- Deprecation window: 2-week dual-emit of `soniox_*` + `tts_*` Langfuse keys — documented in changelog for ops visibility

**Status:** DONE  
**Summary:** Five files updated with fallback feature details. All edits surgical (no restructuring); docs now accurately reflect decorator architecture, env config, and provider abstraction.
