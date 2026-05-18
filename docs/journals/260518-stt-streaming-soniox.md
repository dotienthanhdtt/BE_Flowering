# STT Streaming Integration via Soniox

**Date**: 2026-05-18 10:58
**Severity**: Medium
**Component**: AI Module / Speech Services
**Status**: Resolved

## What Happened

Added full streaming Speech-to-Text (STT) via Soniox to NestJS backend. Built WebSocket gateway at `/ws/speech/stt` with dual auth modes (JWT + sessionId), real-time token streaming via `SonioxStreamHandle`, and automatic audio archival to Railway bucket.

## The Brutal Truth

This was straightforward because the streaming architecture was designed first (plan phase). The implementation merely followed the blueprint — no surprises, no backtracking. That's the payoff of planning.

## Technical Details

**New files**: 7 (provider, buffer, types, auth guard, service, gateway, migrations)
**Modified files**: 10 (interfaces, modules, DTOs, services)
**Tests**: 602/627 passing (0 regressions from STT work; 2 pre-existing failures unrelated)

Key blocker that ate 30min: `@langfuse/langchain` v5 doesn't expose `traceId` in constructor. Workaround: use `sessionId` field instead — when client provides `traceId`, it overrides `conversationId` so STT and LLM events co-locate in the same Langfuse session.

## What We Tried

1. **Passport WS guard** — NestJS WS adapter doesn't support standard HTTP guards. Switched to manual JWT extraction from query param (mobile can't set custom WS headers easily).
2. **Custom Langfuse span methods** — almost added new startSpan/endSpan, but existing OTel span + getConversationContext already handles traceId grouping. YAGNI'd it.
3. **Audio archival with custom content-type** — ObjectStorageService.uploadAudio didn't accept one, so WAV uploads use the existing signature.

## Root Cause Analysis

No real failures — the planning phase (Phase 1) identified all traps (Langfuse sessionId mapping, WS auth constraint, buffer memory limits, audio archival timeout). Implementation just executed the plan.

## Lessons Learned

- **Plan first, implement second**: Knowing the constraints (Langfuse API, NestJS WS limitations, Railway bucket path format) before coding eliminated rework.
- **Use existing abstractions**: ObjectStorageService + OTel span grouping were already there; resisting the urge to redesign saved hours.
- **Dual auth modes are worth the complexity**: sessionId fallback lets onboarding chat work without JWT infrastructure.

## Next Steps

- Monitor STT session timeouts (3-min hard cap) in production
- Watch for audio archival timeouts (2s Promise.race) — may need tuning for slow uploads
- Verify Langfuse sessionId grouping works end-to-end with STT + LLM events in same session
