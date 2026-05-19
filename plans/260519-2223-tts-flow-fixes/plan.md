---
title: TTS flow fixes (C1 + I1/I3/I6)
description: Fix issues raised by adversarial review of TTS Alibaba + Fallback flow.
status: completed
priority: P1
branch: dev
tags:
  - tts
  - bugfix
blockedBy: []
blocks: []
created: '2026-05-19T15:24:10.694Z'
createdBy: 'ck:plan'
source: skill
---

# TTS flow fixes (C1 + I1/I3/I6)

## Overview

Adversarial review (`plans/reports/code-reviewer-260519-2204-tts-flow-adversarial.md`) flagged 1 Critical + 3 must-fix Important issues in TTS flow on `dev`:

- **C1** — `finalizeStream` calls `forceClose()` after Alibaba already self-closed via `task-finished` → races `ws.terminate()` with in-flight `ws.close(1000)` handshake, emits spurious `tts.error` and `closeWithError` on already-completed streams. Poisons error metrics.
- **I1** — Zero test coverage for new `setEventListener` Langfuse path (`tts.fallback_fired` / `tts.fallback_aborted`). Silent regressions possible.
- **I3** — Raw provider error text forwarded to WS client via `closeWithError` reason; only truncated, not sanitized.
- **I6** — `withTimeout` on primary synth doesn't abort in-flight fetch; Soniox slowness leaks sockets + billing.

Defer: I2, I4, I5, M1–M5.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Fix C1 forceClose race](./phase-01-fix-c1-forceclose-race.md) | Completed |
| 2 | [Add Langfuse listener tests](./phase-02-add-langfuse-listener-tests.md) | Completed |
| 3 | [Sanitize client error + abort primary fetch](./phase-03-sanitize-client-error-abort-primary-fetch.md) | Completed |

## Dependencies

None. Phases independent; can run sequentially or in parallel (different files).

## Success Criteria

- `npm run build` clean
- All existing TTS specs pass
- New Langfuse listener assertions pass
- Manual smoke: Alibaba-completion stream produces no `tts.error` Langfuse event
