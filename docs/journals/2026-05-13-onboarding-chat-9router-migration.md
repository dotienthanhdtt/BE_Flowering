# Onboarding Chat & Sentence Translation Routed Through 9Router

**Date**: 2026-05-13 01:11
**Severity**: Medium
**Component**: AI Service, LLM Provider Routing
**Status**: Resolved

## What Happened

Onboarding chat turns and sentence translation were migrated to route through the 9router gateway instead of calling Gemini directly. The change reuses the existing `flowering_chat` alias with a one-shot transparent fallback to `gemini-3.1-flash-lite` on `ServiceUnavailableException`, matching the scenario-chat pattern established on 2026-05-12.

## The Brutal Truth

This continues the 9router consolidation effort. The satisfaction here is that we avoided creating new per-feature aliases or environment variables — we simply extended the existing `IntakeChatEngineConfig` to accept optional `chatModel` and `chatFallbackModel` parameters. Reuse over duplication. The downside: another client depending on 9router availability, though the Gemini fallback mitigates the blast radius.

## Technical Details

**Files Modified:**
- `IntakeChatEngine`: Added optional `chatModel` / `chatFallbackModel` config properties. `runTurn()` now calls `this.llmService.chat()` (9router by default) instead of `this.geminiProvider.chat()` directly.
- `TranslationService.translateSentence()`: Now routes through 9router with Gemini fallback, matching word/chunk translation patterns (which remain on Gemini).
- `onboarding.config.ts`: Wired `flowering_chat` alias and fallback model into the intake engine config.

**Test Coverage Added:**
- `intake-chat-engine.service.spec.ts`: 4 new tests covering chat turn execution and fallback behavior.
- `translation.service.spec.ts`: +3 tests for sentence translation via 9router with fallback.

**Full Test Suite**: 541 passed / 2 skipped. Build + lint clean.

## What We Tried

**Option 1 (chosen)**: Reuse `flowering_chat` alias + add config properties to `IntakeChatEngineConfig`.
- **Pro**: Minimal env var footprint, aligns with scenario-chat precedent, future-proof for swapping models per feature.
- **Con**: Slight config complexity (two optional fields), but mitigated by clear naming.

**Option 2 (rejected)**: Create new `flowering_onboarding_chat` alias + new env var entries.
- **Rejected**: Adds config/env clutter without functional benefit; conflicts with KISS principle.

## Root Cause Analysis

Not a fix—a deliberate routing consolidation. The 9router gateway (OpenAI-compatible) is cheaper and more reliable than direct Gemini calls for these high-volume endpoints. Sentence translation alone sees constant traffic; onboarding chat drives initial user engagement. Moving both through 9router improves observability, cost control, and provider flexibility.

## Lessons Learned

1. **Config Flexibility Matters**: Adding optional `chatModel` / `chatFallbackModel` to `IntakeChatEngineConfig` lets us reuse the same engine for multiple features without hardcoding. Future personalization intake stays on Gemini; onboarding + scenario both hit 9router. No code duplication.

2. **Fallback Strategy Reduces Risk**: The one-shot Gemini fallback isn't perfect (if 9router is truly down, users still wait), but it catches transient `ServiceUnavailableException` and prevents cascading failures. Worth keeping even though it adds ~3 lines per service.

3. **Avoid Env Var Proliferation**: Reusing `NINEROUTER_KEY` / `NINEROUTER_URL` + the `flowering_chat` alias meant zero new environment secrets. Railway deployment just works; no new vars to inject.

## Next Steps

- **Monitor**: Track 9router response times + fallback rates for onboarding chat and sentence translation. If fallback rate >5%, investigate 9router availability.
- **Documentation**: Update system-architecture.md to clarify which features route through 9router vs. direct providers (already done in this commit).
- **Future**: If personalization intake chat performance improves at scale, consider migrating it to 9router as well (currently a Gemini-only path to avoid user friction during profile discovery).

**Owner**: AI Service team  
**Timeline**: Monitoring ongoing; no action items.
