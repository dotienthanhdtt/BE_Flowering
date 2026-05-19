---
phase: 2
title: Add Langfuse listener tests
status: completed
priority: P1
effort: 30m
dependencies: []
---

# Phase 2: Add Langfuse listener tests

## Overview

The post-review commits wired `FallbackTtsStreamHandle.setEventListener(...)` from `tts.gateway.ts:163-173` to emit `tts.fallback_fired` and `tts.fallback_aborted` Langfuse events. Spec file has zero coverage for this path — a regression in wiring would silently kill the dashboards.

## Related Code Files

- Modify: `src/modules/ai/providers/fallback-tts.provider.spec.ts`

## Implementation Steps

1. Add test: **timeout → `tts.fallback_fired`**
   - Build a `FallbackTtsStreamHandle` with mocked primary that never opens, secondary that opens successfully.
   - Register a `jest.fn()` via `handle.setEventListener(listener)`.
   - Advance fake timers past `timeoutMs`.
   - Assert listener called with `{ type: 'tts.fallback_fired', reason: 'timeout', primary: <name>, secondary: <name> }`.
2. Add test: **format-unsupported → `tts.fallback_aborted`**
   - Configure primary that does NOT support requested format, secondary that does NOT support either.
   - Open stream; trigger the abort path in `fallback-tts.stream-handle.ts:208-214`.
   - Assert listener called with `{ type: 'tts.fallback_aborted', reason: 'format_unsupported', requestedFormat: <fmt> }`.
3. Add test: **primary error → `tts.fallback_fired` reason='error'** (if path exists).
4. Run `npm test -- fallback-tts.provider` — confirm new tests pass and existing suite stays green.

## Success Criteria

- [ ] 2+ new tests asserting `setEventListener` invoked with correct payload
- [ ] Test names self-describe scenario (no plan/finding refs in test names)
- [ ] Existing fallback spec stays green
- [ ] No fake-timer leaks

## Risk Assessment

None — test-only addition.

## Notes

- Use real callback invocation; do NOT mock `FallbackTtsStreamHandle` itself.
- Follow existing spec patterns at top of `fallback-tts.provider.spec.ts`.
