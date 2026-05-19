# TTS Alibaba CosyVoice Fallback: Shipping the Decorator

**Date**: 2026-05-19 10:26  
**Severity**: Medium  
**Component**: AI TTS Layer (Soniox → Alibaba fallback)  
**Status**: Resolved  

## What Happened

Shipped decorator-pattern TTS fallback: `FallbackTtsProvider` wraps `SonioxTtsProvider` (primary) + `AlibabaTtsProvider` (secondary). Triggers on Soniox handshake failure OR no audio within 3s. Both streaming (`openStream`) and synthesize paths fall back. Cache uses first-writer-wins (no per-provider keying). 52 new tests, all 70 specs passing, build clean.

## The Brutal Truth

We built something that **looks invisible when it works**. Happy path (Soniox succeeds): zero latency tax, zero Alibaba calls, unchanged behavior. Fallback path (Soniox dies): seamless audio swap but you don't know which provider won without drilling into Langfuse events or logs. Cost-wise: if Soniox is down, every request now pays a 3s race deadline — not crippling, but feels slow until Soniox recovers. We accepted that deliberately over circuit breaker (would require sustained outage detection, v2 work).

The red team found 14 issues (12 accepted, 2 rejected as YAGNI). That's honest. But getting those 12 right felt like threading needles on concurrent state and bytes-in-cache attribution — the kind of work that only breaks in production under weird timing.

## Technical Details

**Decorator choice over alternatives:**
- NOT strategy-in-service: would violate DRY (two places patching inject points, duplicate fallback logic).
- NOT modifying Soniox directly: breaks SRP (Soniox shouldn't know about Alibaba).
- NOT circuit breaker: brainstorm locked connect-time-only. Circuit breaker adds state machine for sustained outages (v2).
- NOT hedged race (2× cost per request): decorator amortizes cost to failure path only.

**Red team findings (12 accepted, 2 rejected):**
- **Critical**: WAV format race (Alibaba mp3 vs gateway pcm request) — fixed by plumbing `audioFormat` through Alibaba, supporting `pcm_s16le @ 24kHz`.
- **High 1**: `SonioxTtsProvider.openStream` throws sync on missing key — wrapper constructor try/catch catches and demotes to secondary-only.
- **High 2**: `_lastWinner` singleton stale (Alibaba win but `cache_hit` reports `provider:soniox`) — per-stream `getWinnerProvider()` + emit `provider:'cache'`.
- **High 3**: `onOpen` undefined ordering — fires once on winner determination via `fireOpenOnce()` flag.
- **High 4**: `forceClose()` racing 3s timer leaks secondary WS + tokens — guard at top of `promoteToSecondary` (`if (forced || winner) return`); `clearTimeout` in `forceClose`.
- **High 5**: `AlibabaTtsProvider.synthesize` direct path no timeout — 15s inactivity timer on handle covers both stream + synth paths.
- **High 6**: `X-DashScope-DataInspection: enable` GDPR sub-processor concern — opt-in only (`ALIBABA_DATA_INSPECTION_ENABLED`, default false).
- **Medium (7)**: API key leak into error.message → `sanitizeMessage()` scrubs both `Bearer\s+\S+` AND literal key fragment (Alibaba echoes it in task-failed error).
- **Medium (2 rejected)**: SSRF hardcode (rejected — YAGNI, Soniox has same pattern); circuit breaker (rejected — brainstorm-confirmed, re-evaluate after first incident).

## What We Tried

Decorator pattern was the lock-in from brainstorm. Red team found 14 findings; all were real (cite file:line); 12 required code changes (format plumbing, per-stream state rewrite, inactivity timeout, sanitization). Acceptance bar was: can this fail in prod? If yes, fix it. Two findings failed that bar: SSRF runtime assertions (gold-plating relative to Soniox), circuit breaker (deferred to v2 with re-evaluation trigger).

## Root Cause Analysis

Why this code looks this way:

1. **Why `FallbackTtsStreamHandle.getWinnerProvider()` instead of singleton `_lastWinner`**: concurrent streams must each track their own winner. Singleton fails when two streams race simultaneously — second stream sees stale winner from first. Per-stream instance solves it, but requires the handle to expose `getWinnerProvider()` so gateway attribution works.

2. **Why `cache_hit` event emits `provider: 'cache'`** (not soniox/alibaba): lossy. Cache was populated by some provider, but we don't store who. v2 defers `audioProvider` column on `ai_conversation_messages`. For now: emit `'cache'` to signal "don't trust this provider field."

3. **Why `resolveProvider()` typeguards on `instanceof FallbackTtsStreamHandle`**: when fallback is disabled or secondary unavailable, `FallbackTtsProvider.openStream` returns `this.primary.openStream(opts)` directly (raw `SonioxTtsStreamHandle`). Gateway must detect this and pass through the underlying handle's `getWinnerProvider()` — otherwise it reports `'tts-fallback'` (wrapper name) instead of `'soniox'`.

4. **Why dual-emit `soniox_*` + `tts_*` log keys**: dashboards were keyed on `soniox_*` for 2 years. Renaming breaks them silently. Dual-emit for 2 weeks, then cleanup. Acknowledged in plan as acceptable tech debt.

5. **Why `X-DashScope-DataInspection` is opt-in**: Alibaba content-moderation review triggers when header is `enable`. GDPR sub-processor concern — users don't opt into moderation. Off by default. Operator sets env var only if they've updated privacy policy.

6. **Why `sanitizeMessage()` scrubs both `Bearer\s+\S+` AND literal apiKey**: first scrubs the auth header pattern (covers most cases). Literal key catches the edge case where Alibaba echoes a fragment of the key in `task-failed` event — user might paste error into bug report, leaking credentials. Defense-in-depth on something that's only 16 chars of entropy anyway.

## Lessons Learned

1. **State machine concurrency is invisible.** Singleton state leaks across concurrent streams. Would have caught this in code review if we'd explicitly run two WS opens in parallel before shipping. Added concurrent-streams test retroactively (RT-M).

2. **Error sanitization is broader than one regex.** Bearer token pattern catches 95% but the service itself may echo credentials in task errors. Need per-provider error-response audits before going live with external APIs.

3. **Red team finds the 3-4 things we'd regret in production.** Format race (poisoned cache), key leak (credentials in logs), inactivity leak (FD exhaustion). Worth the async review. The 2 rejects (SSRF, circuit breaker) were real calls — not security theater.

4. **Dual-emit tech debt has teeth.** Two log key families for 14 days feels harmless. But dashboards silently break if the op forgets to update queries before cutoff. Document the cutoff date explicitly in code comments.

## Next Steps

**v2 follow-ups (deferred, not in scope):**
- Persist `audioProvider` column on `ai_conversation_messages` — enables accurate `cache_hit` attribution post-cache.
- Circuit breaker for sustained Soniox/Alibaba outages — avoid 3s tax on every request during multi-hour outage.
- Per-request `?fallback=false` override — bisect issues (client suspects Alibaba, server suspects Soniox).
- Remove dual-emit `soniox_*` keys after 2-week migration window (cutoff: 2026-06-02).

**Re-evaluation triggers:**
- **First real Soniox outage (hours-long)**: check rate metrics on `tts.fallback_fired`. If >10% 5-min spike → reconsider circuit breaker.
- **First user complaint about cached Alibaba under Soniox voice name**: confirms `cache_hit provider='cache'` is lossy. Pursue audioProvider column.

---

**Status**: DONE  
**Summary**: Decorator-pattern fallback shipped with 12/14 red-team findings applied; concurrent state, format gating, key sanitization, and per-stream attribution all correct; 70 tests passing, build clean, v2 circuit breaker deferred pending first incident.
