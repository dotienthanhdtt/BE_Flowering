---
phase: 4
title: Langfuse & Docs
status: completed
priority: P3
effort: 2h
dependencies:
  - 3
---

# Phase 4: Langfuse & Docs

## Overview

Tighten tracing (link TTS events to originating conversation's trace, not just messageId) and update project docs.

## Requirements
- TTS event surfaces in same Langfuse trace as the LLM call that produced the message (so dashboards show STT → LLM → TTS).
- API + architecture docs reflect new endpoints + new column.

## Architecture
Reuse `LangfuseService.recordEvent(traceId, ...)`. TraceId source order:
1. If `conversation` carries a stored `traceId` (unlikely — verify), use it.
2. Else fall back to `messageId` as bridging key (matches STT pattern of using request-scoped traceId).

If no conversation-level traceId exists, accept fallback — cross-call linking is best-effort.

## Related Code Files
- Modify: `src/modules/ai/speech/tts.service.ts` (centralize traceId resolution)
- Modify: `docs/api-documentation.md` (add 2 REST endpoints + 1 WS endpoint)
- Modify: `docs/codebase-summary.md` (note new column + tts.service location)
- Modify: `docs/project-changelog.md` (add TTS streaming entry)
- Modify: `docs/system-architecture.md` (extend voice-loop diagram if present)

## Implementation Steps
1. Scout existing trace plumbing — confirm conversation has no `traceId` column; document fallback.
2. Wrap all tts events in `try/catch` (tracing is best-effort, never fails request).
3. Update 4 docs in batch.

## Success Criteria
- [ ] Langfuse dashboard shows `tts.synthesize` event tied to conversation's most recent LLM trace (manual verify).
- [ ] `docs/api-documentation.md` lists `POST /ai/speech/tts`, `POST /ai/speech/tts/onboarding`, `WS /ws/speech/tts`.
- [ ] Changelog entry added.

## Risk Assessment
Low. Docs-only + best-effort tracing.
