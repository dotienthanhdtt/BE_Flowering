---
phase: 4
title: "Chat Integration (Onboarding + Scenario)"
status: complete
priority: P2
effort: "3h"
dependencies: [3]
completedDate: "2026-05-18T11:27:00.000Z"
---

# Phase 4: Chat Integration (Onboarding + Scenario)

## Overview
Wire the client-supplied `traceId` through onboarding and scenario chat endpoints so the LLM completion span lands inside the same Langfuse trace as the STT span. No new endpoints; minimal additive DTO + service plumbing.

## Requirements
- Functional:
  - `POST /onboarding/chat` and `POST /scenario/chat/...` (existing) accept optional `traceId: string` (UUID) in body.
  - When present, LLM calls use it as the Langfuse trace id. When absent, existing default behavior (server mints one).
  - No breaking change for current mobile builds.
- Non-functional:
  - Validate `traceId` is UUID v4 with `class-validator` `@IsUUID('4')`.

## Architecture
```
Mobile: traceId = uuid()
      ─► WS /ws/speech/stt?traceId=...    (Phase 2 — span: stt.session)
      ─► POST /chat {message, traceId}    (Phase 4 — span: llm.completion)
                                            └─► same trace in Langfuse
```

## Related Code Files
- Modify: `src/modules/onboarding/dto/*-chat.dto.ts` (add optional `traceId`)
- Modify: `src/modules/onboarding/onboarding.service.ts` (pass traceId to LLM)
- Modify: `src/modules/scenario/dto/*-chat*.dto.ts` (add optional `traceId`)
- Modify: `src/modules/scenario/services/*-chat*.service.ts` (pass traceId to LLM)
- Modify: `src/modules/ai/services/learning-agent.service.ts` and/or `unified-llm.service.ts` — accept `traceId?: string` and forward to Langfuse callback handler.
- Read for context: `src/modules/ai/services/langfuse-tracing.service.ts`

## Implementation Steps
1. Audit Langfuse callback handler creation in `unified-llm.service.ts` / `learning-agent.service.ts`. Identify where `traceId`/`sessionId` is currently set on `CallbackHandler({ traceId })` or equivalent.
2. Add optional `traceId?: string` to the chat-invocation method signatures all the way through to the LLM call site. Do NOT change downstream signatures that don't need it (YAGNI).
3. Add `@IsUUID('4') @IsOptional() traceId?: string` to both onboarding and scenario chat DTOs.
4. In services, when `traceId` provided, pass it through. When absent, keep current behavior.
5. Verify Langfuse SDK supports supplying a deterministic `traceId` on a CallbackHandler. If only a `name` and auto-generated id is supported, switch to explicit `traceId` option (Langfuse JS SDK supports `traceId` in handler constructor).
6. Manual smoke test: open WS, end session, take returned `traceId`, POST chat with same `traceId`, verify Langfuse UI shows single trace with `stt.session` + `llm.completion` siblings.

## Success Criteria
- [x] Onboarding chat DTO accepts `traceId` (optional UUID v4)
- [x] Scenario chat DTO accepts `traceId` (optional UUID v4)
- [x] Provided `traceId` reaches Langfuse CallbackHandler
- [x] Langfuse UI shows single trace containing both `stt.session` and `llm.completion` spans for one voice turn
- [x] Absent `traceId` preserves existing behavior (no regression in current text-only flow)
- [x] `npm run build` clean

## Risk Assessment
- Trace id collisions if mobile reuses UUIDs → vanishingly small with UUID v4; acceptable.
- A malicious client could spoof another user's traceId → traces are scoped per-project in Langfuse and read-only; impact is observational only. Optional: prefix with userId on backend before sending to Langfuse if leakage is a concern. v1: accept as-is.
- LangChain `CallbackHandler` API drift → consult `@langfuse/langchain` for current constructor options before code.
