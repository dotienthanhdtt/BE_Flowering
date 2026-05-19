# Test Report: Alibaba TTS + Fallback TTS Providers
**Date:** 2026-05-19 | **Tester:** QA Lead | **Status:** PASS

---

## Executive Summary

Successfully created and validated comprehensive unit test suites for two new NestJS TTS providers:
- `AlibabaTtsProvider` (19 tests, all passing)
- `FallbackTtsProvider` (33 tests, all passing)

**Total: 52 new tests, 100% passing. Build clean. No regressions.**

---

## Test Coverage & Scenarios

### AlibabaTtsProvider Spec (`alibaba-tts.provider.spec.ts`)

**19 tests covering:**

| Category | Scenario | Coverage | Status |
|----------|----------|----------|--------|
| **Config** | `isAvailable()` when key present/missing | ✓ | PASS |
| **Format support** | `supportsFormat()` for all supported/unsupported formats | ✓ | PASS |
| **Constructor** | Rejects unsupported `audioFormat` and `sampleRate` | ✓ [RT-A] | PASS |
| **Stream setup** | Format normalization (pcm_s16le→pcm), header auth | ✓ [RT-A] | PASS |
| **Happy path** | Open → run-task → buffering → task-started → continue-task → audio → task-finished → onEnd(true) | ✓ | PASS |
| **Buffering** | Text buffered before task-started, sent after event | ✓ | PASS |
| **Error handling** | task-failed event with error code+message → onError fires | ✓ | PASS |
| **Sanitization** | Error messages strip Bearer tokens AND API keys | ✓ [RT-G] | PASS |
| **Premature close** | WS close before task-finished → onEnd(false) | ✓ | PASS |
| **Inactivity timeout** | No message for 15s → onError + ws.terminate | ✓ [RT-F] | PASS |
| **Timer reset** | Message resets 15s countdown (14s+msg+14s = no timeout) | ✓ [RT-F] | PASS |
| **Synthesize happy** | Full stream accumulates audio chunks, returns concatenated Buffer | ✓ | PASS |
| **Synthesize error** | Error → rejects + forceClose invoked | ✓ | PASS |
| **Synthesize config** | ServiceUnavailable when API key missing | ✓ | PASS |
| **DataInspection disabled** | X-DashScope-DataInspection header NOT present (default) | ✓ [RT-I] | PASS |
| **DataInspection enabled** | X-DashScope-DataInspection header present with value 'enable' | ✓ [RT-I] | PASS |

**Red-team coverage:** RT-A (format plumbing, constructor validation), RT-F (inactivity), RT-G (sanitization), RT-I (conditional header)

---

### FallbackTtsProvider Spec (`fallback-tts.provider.spec.ts`)

**33 tests covering:**

| Category | Scenario | Coverage | Status |
|----------|----------|----------|--------|
| **Availability** | isAvailable() returns true if either provider available | ✓ | PASS |
| **Format support** | supportsFormat() returns true if either provider supports | ✓ | PASS |
| **Race: primary wins** | Audio from primary <3s → only primary.openStream, secondary never called | ✓ | PASS |
| **Race: error→secondary** | Primary error before audio → secondary.openStream immediately | ✓ | PASS |
| **Race: timeout** | No audio in 3s → secondary opens, primary forceClose called | ✓ | PASS |
| **forceClose mid-race** | Called before deadline → forced flag set → secondary never opens on deadline | ✓ [RT-E] | PASS |
| **forceClose after promotion** | Called after secondary opens → secondary.forceClose invoked | ✓ [RT-E] | PASS |
| **Primary sync throw** | openStream() throws ServiceUnavailableException → secondary opens immediately | ✓ [RT-B] | PASS |
| **Format unsupported by secondary** | Client requests fmt → primary times out → secondary.supportsFormat=false → fallback aborts | ✓ [RT-A] | PASS |
| **Format supported by secondary** | Client requests fmt → primary times out → secondary supports → opens with fmt | ✓ [RT-A] | PASS |
| **getWinnerProvider pending** | Returns 'pending' before race settles | ✓ [RT-C] | PASS |
| **getWinnerProvider primary** | Returns 'soniox' after primary emits audio | ✓ [RT-C] | PASS |
| **getWinnerProvider secondary** | Returns 'alibaba-cosyvoice' after promotion | ✓ [RT-C] | PASS |
| **onOpen fires once** | Called exactly once on winner determination, not repeated | ✓ [RT-D] | PASS |
| **onOpen after promotion** | Fires once after secondary wins (not on every internal WS open) | ✓ [RT-D] | PASS |
| **Concurrent streams** | Two simultaneous openStream() → both promote independently → no state corruption | ✓ [RT-M] | PASS |
| **Synth: primary resolves** | Primary <5s → result with provider='soniox' | ✓ | PASS |
| **Synth: primary throws** | Primary throws → secondary called → result with provider='alibaba-cosyvoice' | ✓ | PASS |
| **Synth: primary timeout** | Primary >5s → secondary called (timeout wraps it) | ✓ | PASS |
| **Synth: primary unavailable** | primary.isAvailable=false → secondary.synthesize called directly | ✓ | PASS |
| **Synth: secondary unavailable** | secondary.isAvailable=false → primary.synthesize (no fallback) | ✓ | PASS |
| **Synth: fallback disabled** | fallbackEnabled=false → primary called even if throws | ✓ | PASS |
| **Synth: both unavailable** | Neither provider available → throws ServiceUnavailableException | ✓ | PASS |
| **Synth: format unsupported** | Both unavailable for format → throws ServiceUnavailableException | ✓ | PASS |
| **Passthrough: primary only** | primary available, secondary unavailable → return primary handle directly | ✓ | PASS |
| **Passthrough: secondary only** | secondary available, primary unavailable → return secondary handle directly | ✓ | PASS |
| **Passthrough: none available** | Both unavailable → throws ServiceUnavailableException | ✓ | PASS |
| **Passthrough: fallback disabled** | fallbackEnabled=false, secondary unavailable → return primary handle | ✓ | PASS |
| **Buffering and replay** | Text buffered during race → replayed to secondary on promotion | ✓ | PASS |

**Red-team coverage:** RT-A (format checking), RT-B (sync throw), RT-C (per-stream attribution), RT-D (onOpen-once), RT-E (forceClose race guard), RT-M (concurrent state isolation)

---

## Test Execution Results

```
Test Suites: 2 passed, 2 total
Tests:       52 passed, 52 total
Snapshots:   0 total
Time:        4.309 s
```

**New specs only:**
- `alibaba-tts.provider.spec.ts`: 19 tests ✓
- `fallback-tts.provider.spec.ts`: 33 tests ✓

**Full suite impact:** Build clean, no regressions in other modules (pre-existing failures in scenario tests unrelated to TTS changes).

---

## Build Verification

```
✓ npm run build        — TypeScript compilation clean
✓ Jest execution       — All 52 tests passing
✓ No mock leaks        — jest.clearAllMocks() in afterEach
✓ Fake timer cleanup   — jest.useRealTimers() in afterEach
```

---

## Mocking Strategy

### AlibabaTtsProvider
- **ws module:** Mocked via `jest.mock('ws')`. WS instance (`readyState`, `on`, `send`, `terminate`) fully controllable.
- **ConfigService:** Injected mock with hardcoded config map for test isolation.
- **Callbacks:** Fire via mock callback registration (onAudio, onError, onEnd).
- **Timer-based tests:** Jest fake timers advance inactivity timeout, verify error + terminate fired.

### FallbackTtsProvider
- **Primary/Secondary providers:** Object mocks with `jest.fn()` for each method.
- **Logger:** Injected mock to capture fallback_fired warnings.
- **Handles:** Partial Typescript mocks with controllable callbacks.
- **Race condition:** Fake timers control deadline (3s), verify secondary promotion on time vs audio.
- **Concurrent state:** Two simultaneous instances, each tracked independently via closures.

---

## Coverage by Red-Team Requirement

| ID | Requirement | Test Location | Result |
|----|-------------|----------------|--------|
| RT-A | Format plumbing (normalized, constructor throws, supportsFormat) | alibaba:11,12 / fallback:13,14 | ✓ |
| RT-B | Primary sync throw → immediate secondary open | fallback:17 | ✓ |
| RT-C | Per-stream getWinnerProvider() attribution | fallback:21,22,23 | ✓ |
| RT-D | Consumer onOpen fires exactly once | fallback:24,25 | ✓ |
| RT-E | forceClose() mid-race guards secondary open | fallback:15,16 | ✓ |
| RT-F | Inactivity timeout after 15s, reset on message | alibaba:13,14 | ✓ |
| RT-G | Error sanitization (Bearer tokens + API keys) | alibaba:7,8 | ✓ |
| RT-I | Conditional X-DashScope-DataInspection header | alibaba:17,18 | ✓ |
| RT-M | Concurrent streams, independent promotion | fallback:26 | ✓ |

---

## Unresolved Questions

None. All scenarios specified in phase-04 plan are tested and passing.

---

## Recommendations

1. **Next phase:** Smoke test in dev Railway with DASHSCOPE_API_KEY populated (manual checklist per plan phase-04).
2. **WAV header validation:** When gateway emits WAV-encoded cache entries, add coverage for pcm_s16le format selection.
3. **Langfuse integration:** Verify `tts.fallback_fired` event payload in live dashboard; current tests verify code path, not event structure.

---

**Status: DONE**
All required test scenarios covered and passing. Specs are production-ready pending smoke validation.
