# Brainstorm: Alibaba CosyVoice as Soniox Fallback

- **Date:** 2026-05-19
- **Related:** [research-260519-0944-alibaba-realtime-tts-migration.md](./research-260519-0944-alibaba-realtime-tts-migration.md)
- **Decision:** Keep Soniox primary; add Alibaba CosyVoice as automatic fallback on Soniox connect-time failure.

---

## Problem Statement

Soniox realtime TTS occasionally fails (WS handshake, transport, rate-limit). When it does, end-users get no audio. Add a second provider so the system degrades gracefully without operator intervention.

Scope: both streaming (`TtsStreamingProvider.openStream`) and non-streaming (`TtsProvider.synthesize`) paths.

## Requirements (locked)

| # | Requirement |
|---|---|
| R1 | Soniox stays primary; Alibaba fires only on Soniox failure |
| R2 | Trigger = connect-time only: WS handshake error OR no audio within 3s |
| R3 | Mid-stream Soniox drops surface to user as-is (no replay) |
| R4 | Voice mismatch acceptable (Soniox `Adrian` vs CosyVoice `longanyang`) |
| R5 | Both `openStream` and `synthesize` fall back |
| R6 | Cache: single key, first-writer-wins (no provider in cache key) |
| R7 | Singapore endpoint only (`wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference`) |
| R8 | Match audio format: `mp3 @ 24000 Hz` (parity with Soniox config) |
| R9 | Log `tts.fallback_fired=true` once per stream when Alibaba wins |
| R10 | `TtsService` and `tts.gateway.ts` see no API change |

## Final Solution: Decorator Provider

### Architecture

```
TtsGateway / TtsService
        │
        ▼  (TtsStreamingProvider interface — unchanged)
┌─────────────────────────────────┐
│  FallbackTtsProvider            │
│  ├── primary:   SonioxProvider  │
│  └── secondary: AlibabaProvider │
│                                 │
│  openStream() → FallbackHandle  │
│  synthesize() → try/catch+timeout│
└─────────────────────────────────┘
```

### Streaming flow

```
openStream(opts)
  ├─ Open Soniox WS; start 3s "first-audio" deadline
  ├─ Buffer consumer's start(text) as pendingText (existing pattern)
  ├─ Race:
  │    Soniox sends first audio chunk in ≤3s
  │      → Soniox wins; forward all callbacks transparently to consumer
  │    Soniox onError OR deadline fires without audio
  │      → terminate Soniox WS
  │      → open Alibaba WS; forward Alibaba callbacks
  │      → log fallback_fired=true
  ├─ Consumer's onOpen fires when WINNER opens (not initial Soniox open)
  └─ Post-winner: mid-stream errors propagate unchanged
```

Key invariants:
- Consumer never sees Soniox's failed audio chunks (deadline = no audio yet).
- `completed=true` (cacheable) still requires the winner's audio_end / task-finished event.
- `forceClose()` from consumer must kill whichever WS is currently active (or both during race).

### Non-streaming flow

```ts
async synthesize(text, opts) {
  try {
    return await withTimeout(this.primary.synthesize(text, opts), 5000);
  } catch (err) {
    this.logger.warn('Soniox synth failed, falling back to Alibaba', err);
    return await this.secondary.synthesize(text, opts);
  }
}
```

Alibaba `synthesize()` implemented over WS (no REST exists): open → run-task → continue-task → finish-task → concatenate binary frames → return Buffer. Single-shot, close after task-finished.

### Provider registration

`AiModule` binds `TtsStreamingProvider` token to `FallbackTtsProvider`. Soniox + Alibaba providers stay as separate `@Injectable()` classes consumed by the wrapper. No changes to `TtsService` / `tts.gateway.ts`.

## Approaches considered

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Decorator provider** (chosen) | Zero changes to TtsService/gateway; SRP clean; one new class | Slight complexity in handle race logic | ✅ Picked |
| B. Strategy in TtsService | Explicit; easy to read | Fallback logic duplicated in service + gateway; harder to unit-test | ❌ Violates DRY |
| C. Circuit breaker | Survives sustained outages; less per-request overhead | YAGNI now; per-request connect-only is enough | ❌ Defer |
| D. Hedged race (open both) | Lowest latency on failure | 2× cost + quota every request | ❌ Wasteful |
| E. Modify Soniox provider | Fewest new files | Two responsibilities in one class; SRP violation | ❌ Rejected |

## Implementation Considerations

### Config additions
```ts
ai.ttsFallbackEnabled        // default true
ai.ttsFallbackTimeoutMs      // default 3000
ai.dashscopeApiKey           // env: DASHSCOPE_API_KEY
ai.alibabaTtsModel           // default 'cosyvoice-v3-flash'
ai.alibabaTtsVoice           // default 'longanyang'
ai.alibabaTtsFormat          // default 'mp3'
ai.alibabaTtsSampleRate      // default 24000
```

### Files to add
```
src/modules/ai/providers/
  alibaba-tts.provider.ts          # NEW — CosyVoice WS (run-task/continue-task/finish-task)
  alibaba-tts.provider.spec.ts     # NEW
  fallback-tts.provider.ts         # NEW — Decorator
  fallback-tts.provider.spec.ts    # NEW
```

### Files to modify
```
src/modules/ai/ai.module.ts        # Bind FallbackTtsProvider to TtsStreamingProvider token
src/config/app-configuration.ts    # Add dashscope + fallback config keys
.env.example                       # DASHSCOPE_API_KEY, TTS_FALLBACK_*
```

### Files unchanged
```
src/modules/ai/speech/tts.service.ts
src/modules/ai/speech/tts.gateway.ts
src/modules/ai/providers/tts-provider.interface.ts
src/modules/ai/providers/soniox-tts.provider.ts
```

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Cache pollution: Alibaba audio cached under Soniox-style key, replays Alibaba voice indefinitely | Med | Accepted per R6; voice difference is audible cue that Soniox was down. Re-evaluate if user complaints |
| Soniox sends 1 byte at 2.9s — "wins" then dies → user gets broken audio | Low | Deadline = first-audio not handshake-only; mid-stream drop → `completed=false` → not cached; next request retries Soniox |
| Both providers fail | Low | Propagate last error (Alibaba's); user sees `ServiceUnavailable` same as today |
| Alibaba quota/key not configured at deploy | Med | `isAvailable()` checks; if Alibaba unconfigured, FallbackProvider degrades to Soniox-only (no fallback). Add startup-time warning log |
| Format/sample-rate drift breaks WAV header math in gateway | Med | Force Alibaba `mp3 @ 24000` to match; assert in provider constructor |
| Race condition: consumer calls `forceClose()` during 3s race window | Low | FallbackHandle tracks active WS handle(s); `forceClose` terminates all |
| Soniox returns valid audio but Alibaba was opened in parallel | N/A | We don't open Alibaba until Soniox loses; no parallel cost |
| Token cost spike during Soniox outage | Low | Expected; monitor `tts.fallback_fired` counter; alert if >X% sustained |

## Success Metrics

- **Functional:** End-user audio success rate ≥ 99.5% (vs Soniox-only baseline).
- **Observability:** `tts.fallback_fired` log/metric per stream; aggregate dashboard.
- **Latency:** P95 latency on fallback path ≤ Soniox-baseline + 3s (deadline) + 500ms (Alibaba TTFB).
- **Cost:** Alibaba-traffic share ≤ 5% in steady state (validates Soniox is healthy most of the time).

## Validation Plan

1. Unit tests for `FallbackTtsProvider`:
   - Soniox open + audio in 100ms → Soniox path used; Alibaba never opened.
   - Soniox open + no audio in 3s → Alibaba opens; consumer receives Alibaba audio; `fallback_fired` log present.
   - Soniox `onError` during handshake → Alibaba opens immediately.
   - Soniox unconfigured → goes straight to Alibaba (no 3s wait).
   - Both unconfigured → `ServiceUnavailable` thrown.
   - `forceClose()` mid-race → both WS handles closed.
2. Integration test: kill Soniox API key in test config; verify gateway still streams audio (Alibaba path).
3. Smoke test on Railway: temporary breakpoint Soniox URL; confirm user-facing audio still plays.

## Next Steps

1. Read current TTS cache implementation to confirm R6 assumption (need to verify no provider tag in cache key).
2. Implement `AlibabaTtsProvider` (CosyVoice WS).
3. Implement `FallbackTtsProvider` (decorator).
4. Wire DI in `AiModule`.
5. Update `.env.example` + Railway env vars.
6. Run `npm run build` + tests before push.

## Unresolved Questions

None — design locked. Ready for `/ck:plan`.
