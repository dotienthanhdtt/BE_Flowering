# Research Report: TTS Feature — Stream Contract Questions

**Date:** 2026-05-20 09:13 | **Scope:** be_flowering TTS feature, 4 stream-contract questions
**Method:** codebase read (no web research needed — all answers are in-repo)

---

## Executive Summary

The TTS feature is a dual-transport (REST + WebSocket) text-to-speech pipeline with a
Soniox-primary / Alibaba-CosyVoice-secondary fallback race. The WS path (`/ws/speech/tts`)
streams audio frame-by-frame for low time-to-first-audio.

Three of the four questions are **answerable directly from server code** (Q1, Q2, Q4-server-side);
Q3 has an engineering target but no product SLA. Key finding: the `wav` streaming path is
**not** raw PCM today — the server prepends a 44-byte RIFF header to frame #1 and forces
24kHz/mono/16-bit, so the client currently receives a valid WAV stream, not headerless PCM.

---

## TTS Feature Overview

| Aspect | Detail |
|---|---|
| REST | `POST /ai/speech/tts` + `/onboarding` — synth full buffer → upload → signed URL. Always `.mp3`. |
| WS | `wss://…/ws/speech/tts?messageId=…&format=mp3\|wav` — frame-streamed. `mp3` is default. |
| Providers | `FallbackTtsProvider` wraps `SonioxTtsProvider` (primary) + `AlibabaTtsProvider` (secondary, CosyVoice). 3s first-audio race → promote to secondary. |
| Cache | First completed synth persisted to object storage; `audioUrl` on `ai_conversation_messages`. Cache hit → stream stored file, no provider call. |
| Caps | 5000 char limit; WS 60s max-duration hard timeout. |
| `wav` mode rationale | Added to fix an Android MP3 "plays twice" bug (two-phase codec init). PCM-in-WAV gives the player a known format up front. |

---

## Q1 — Can the server emit raw PCM (drop the RIFF wrapper)?

**Answer: Yes, trivially — but today it does NOT. The server owns the RIFF header.**

Current `wav`-mode contract (`tts.gateway.ts`):
- Server requests **raw PCM** from the provider: `audioFormat: 'pcm_s16le'` (`tts.gateway.ts:161`).
  Providers return headerless PCM samples.
- Server prepends a **44-byte streaming RIFF header** to WS frame #1, then sends raw PCM
  for every subsequent frame:
  ```
  if (session.outputFormat === 'wav' && !session.headerSent) {
    session.headerSent = true;
    client.send(buildStreamingWavHeader(PCM_FORMAT), { binary: true }); // tts.gateway.ts:229-231
  }
  client.send(chunk, { binary: true });
  ```
- The cached object gets a **different** header — `buildFinalizedWavHeader` with the real
  data size (`tts.gateway.ts:409`). Streaming header ≠ persisted header.

To emit raw PCM: delete the `buildStreamingWavHeader` send (3 lines). Providers already
produce raw `pcm_s16le`; no provider change needed.

**Caveat that makes this a real decision, not a coin-flip:** the streaming header's size
fields are **fake** — `0x7FFFFFFF` placeholder, not real length (`wav-header.ts:62-64`).
The value `0x7FFFFFFF` (not the conventional `0xFFFFFFFF`) was deliberately chosen to dodge
an Android Media3 `WavExtractor` int32-overflow bug that stalled `STATE_ENDED`. So in
streaming mode the 44-byte header is purely a **format-declaration vehicle**
(sampleRate / channels / bitsPerSample), never a length contract. If the client strips it,
it must carry sampleRate/channels/bits some other way.

**Recommendation:** Keep the server-side RIFF header *unless* the iOS client specifically
wants headerless PCM for `AVAudioPCMBuffer`. If it does, drop the header AND add a metadata
frame (see Q2) — don't make the client strip 44 bytes blind, because the size field is
meaningless and would mislead any strict parser.

---

## Q2 — Is TTS output always 24kHz mono, or does it vary by provider?

**Answer: For the WS `wav` path, it is HARD-FORCED to 24kHz / mono / 16-bit by the gateway —
it does NOT vary by provider. But the coupling is a hardcoded constant, not negotiated.**

- Gateway constant: `const PCM_FORMAT = { sampleRate: 24000, channels: 1, bitsPerSample: 16 }`
  (`tts.gateway.ts:17`). Used for both the streaming header and the finalized cache header.
- The gateway passes `sampleRate: 24000` **explicitly** into `openStream()`
  (`tts.gateway.ts:162`). Both providers honor the override (`opts.sampleRate || this.sampleRate`),
  so the env defaults (`SONIOX_TTS_SAMPLE_RATE`, `ALIBABA_TTS_SAMPLE_RATE`, both `24000`) are
  **bypassed** on the wav path. → Soniox and Alibaba both stream 24kHz regardless of config.
- Channels: never sent to providers; both default to mono. 16-bit is implied by `pcm_s16le`.

**So: raw-PCM playback can safely hardcode 24kHz mono s16le today.** A metadata frame is
**not strictly required right now.**

**But two real risks argue for carrying the rate explicitly:**
1. **Silent coupling.** `PCM_FORMAT.sampleRate` is a magic constant with no link to the
   client. If product later changes it, server + client must change in lockstep or audio
   plays at the wrong pitch/speed. The RIFF header currently *is* that contract — dropping
   it removes the only thing keeping client and server agreed.
2. **Provider capability divergence.** Alibaba validates against
   `{8000,16000,22050,24000,44100,48000}` (`alibaba-tts.stream-handle.ts:18`); Soniox does
   no validation. They agree at 24kHz only because the gateway forces it — not because the
   providers are intrinsically locked.

**Recommendation:** If you go headerless PCM, send a one-shot JSON metadata frame
(`{type:'audio_meta', sampleRate, channels, bitsPerSample}`) before frame #1. Cost is
trivial and it kills the silent-coupling bug permanently. Otherwise keep the RIFF header —
it already encodes exactly this.

> Note: do not conflate with STT — STT input is **16kHz** (`audio-pcm-buffer.ts:1`,
> `soniox-stt.provider.ts:61`). TTS output is 24kHz. Different rates.

---

## Q3 — Does product have a TTFS (time-to-first-sound) target?

**Answer: No formal product SLA found. There is an engineering target: ~500ms first audio chunk.**

- WS streaming plan acceptance criterion: *"delivers the first audio chunk to the client
  within ~500ms (target)"* (`brainstorm-260518-1227-tts-streaming-soniox.md:254`).
- The WS-over-REST rationale cited *"~200ms vs ~1s"* time-to-first-audio for longer replies
  (`brainstorm-260518:52`) — i.e. ~200ms is the *modeled best case*, not a committed target.
- A flagged risk: Soniox `tts-rt-v1` first-chunk latency is undocumented, *"could be ~500ms
  anyway, making WS advantage marginal"* (`brainstorm-260518:244`).
- The gateway already instruments this precisely: `tts_first_audio_ms`, `total_first_chunk_ms`,
  `tts_connect_ms` Langfuse events (`tts.gateway.ts:204-221`) — so real numbers are
  measurable in dashboards now.

**On the "K vs F" framing:** those option labels are not in this repo (they belong to the
mobile-side review). What the server side tells you: the WS path was *built* to chase a
~200-500ms TTFS, and the telemetry to validate it already exists. Whether K's extra effort
is justified should be decided against **measured** `tts_first_audio_ms` from Langfuse, not
a guessed target. If measured TTFS is already ≤500ms with approach F, K's marginal gain is
likely not worth it (matches the brainstorm's own risk note).

**Unresolved — needs product input:** is there a hard "feels instant" threshold
(e.g. <200ms)? Not documented anywhere in `be_flowering`.

---

## Q4 — AVAudioEngine playback + simultaneous record: coexist or strict alternation?

**Answer: This is a CLIENT architecture decision — the server does not dictate it. The server
*permits* full-duplex but provides no barge-in / interruption signaling.**

Server-side facts:
- TTS and STT are **separate WS endpoints** with **independent** session maps:
  `/ws/speech/tts` (`tts.gateway.ts:46`, `clientSessions` WeakMap) vs `/ws/speech/stt`
  (`speech.gateway.ts:14`, separate `clientSessions` WeakMap).
- **No cross-guard.** Nothing stops a TTS stream and an STT stream being open at the same
  time. → server-side full-duplex is technically possible.
- STT *does* reject a second **STT** session for the same principal:
  `if (this.speech.hasSession(principalId)) … close(4429,'concurrent')` (`speech.gateway.ts:33`).
  This guards STT-vs-STT only, not TTS-vs-STT.
- **No barge-in primitive.** TTS gateway accepts no client→server "stop/cancel" message; STT
  has no coordination channel to TTS. Any interruption logic must live entirely client-side.
- The TTS gateway code comments assume **sequential playback**: the `0x7FFFFFFF` header fix
  exists precisely because a stalled player *"blocks the next utterance's playback"* and
  *"our streaming player then waits on"* it (`wav-header.ts` comment). The design as built
  assumes: TTS utterance N plays → finishes → utterance N+1. That points to a
  **strict-alternation conversation loop**, not continuous duplex.

**Recommendation:** The server is loop-agnostic, so this is purely the iOS app's call:
- **Strict alternation (TTS plays → then record)** matches the current server design with
  zero server changes. Simplest; no echo-cancellation needed; matches the streaming-player
  assumption already baked in.
- **Full-duplex / barge-in** (record while TTS plays) is possible transport-wise but needs:
  (a) client-side AEC, (b) a new client→server TTS "cancel" message so an interrupted
  utterance stops billing/streaming, (c) decide whether a barged utterance still persists to
  cache (`providerCompleted` gating in `tts.gateway.ts:377` currently discards partials).

If product wants barge-in, that is a **server change** (add TTS cancel message + cache
policy) — flag it as scope, don't assume the current code supports it.

---

## Summary Table

| Q | Short answer | Server change needed? |
|---|---|---|
| 1 Raw PCM | Possible (drop 1 header send). Today server emits RIFF-wrapped WAV. | Tiny, if desired |
| 2 Sample rate | Forced 24kHz/mono/s16le by gateway constant; does NOT vary by provider. Hardcoded, not negotiated. | None today; add meta frame if going headerless |
| 3 TTFS target | No product SLA. Engineering target ~500ms; telemetry exists — decide K-vs-F on measured data. | None |
| 4 Duplex vs alternate | Server permits both; built assuming strict alternation; no barge-in primitive. | Barge-in = server change (TTS cancel msg) |

---

## Unresolved Questions

1. **Product:** Is there a hard TTFS "feels instant" threshold (<200ms)? Not in `be_flowering` docs.
2. **Product/mobile:** Does the conversation loop need barge-in, or is strict TTS→record
   alternation acceptable? Determines whether a server-side TTS-cancel message is in scope.
3. **Mobile:** "K vs F" option labels are from the mobile review, not this repo — confirm
   what they map to before using this report's Q3 conclusion.
4. If headerless PCM is chosen: confirm the iOS client will consume a JSON metadata frame
   (vs. an out-of-band agreed constant).
