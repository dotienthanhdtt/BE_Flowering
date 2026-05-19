# Research Report: Migrate Realtime TTS from Soniox → Alibaba Cloud DashScope

- **Date:** 2026-05-19
- **Topic:** Replace `SonioxTtsProvider` (WebSocket realtime TTS) with Alibaba Cloud Model Studio realtime TTS (CosyVoice / Qwen-TTS)
- **Current code:** `src/modules/ai/providers/soniox-tts.provider.ts`, `tts-provider.interface.ts`, `speech/tts.gateway.ts`
- **Doc source:** https://www.alibabacloud.com/help/en/model-studio/realtime-tts-user-guide + CosyVoice WebSocket API reference

---

## Executive Summary

Alibaba offers two realtime TTS families on DashScope, with **two different WebSocket protocols**:

1. **CosyVoice** (`cosyvoice-v3-flash`, `cosyvoice-v3.5-flash`, `cosyvoice-v3.5-plus`, `cosyvoice-v2`) — DashScope "inference" WS at `/api-ws/v1/inference`, action-based protocol (`run-task` → `continue-task` → `finish-task`). Audio returned as **binary WS frames**.
2. **Qwen-TTS Realtime** (`qwen3-tts-flash-realtime`, `qwen3-tts-instruct-flash-realtime`) — Newer "realtime" WS at `/api-ws/v1/realtime?model=...`, OpenAI-Realtime-style event protocol.

**Recommendation:** Migrate to **CosyVoice v3-flash** first. It is the lowest-latency, lowest-cost system-voice option; protocol is well documented; binary audio frames map cleanly onto our existing `TtsStreamHandle.onAudio(Buffer)` interface. Qwen-TTS only if you need instruction-based emotion control or Cherry-style voices.

Migration is structurally similar to current Soniox flow but with **3 key differences**:
- Action lifecycle (`run-task` → confirm → `continue-task`(s) → `finish-task` → `task-finished`) instead of single config-then-text frame.
- Audio is **raw binary WS frames**, not base64-in-JSON (simpler — drop the `Buffer.from(msg.audio, 'base64')` path).
- Mandatory `task_id` (UUID) reused across all instructions of one synthesis.

No HTTP REST equivalent for CosyVoice — only WebSocket. (Qwen has both; not relevant for streaming use case.)

---

## 1. Protocol Comparison

| Aspect | Soniox (current) | Alibaba CosyVoice (proposed) |
|---|---|---|
| URL | `wss://tts-rt.soniox.com/tts-websocket` | `wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference` (SG) / `wss://dashscope.aliyuncs.com/api-ws/v1/inference` (CN-Beijing) |
| Auth | `api_key` in first JSON frame | `Authorization: Bearer <DASHSCOPE_API_KEY>` HTTP header |
| Headers | None special | `X-DashScope-DataInspection: enable` (optional, content moderation) |
| Session start | Send config JSON with `api_key`, `model`, `voice`, `audio_format`, `sample_rate`, `stream_id` | Send `run-task` JSON instruction with `task_id` (UUID) |
| Server ack | Implicit (audio begins) | Explicit `task-started` event — **must wait before sending text** |
| Text send | Single JSON `{text, text_end: true, stream_id}` | One or more `continue-task` JSON, each with `input.text` |
| End signal | Implicit (text_end flag) | Explicit `finish-task` JSON |
| Audio transport | Base64 string inside JSON message | **Binary WS frames** (raw bytes) |
| Completion event | `audio_end: true` or `terminated: true` (JSON) | `task-finished` event (JSON) |
| Error event | `error` field in JSON | `task-failed` event with `error_code` + `error_message` |
| Connection reuse | New WS per request | Recommended to reuse WS across multiple tasks (new `task_id` per task) |

---

## 2. CosyVoice WebSocket Lifecycle

```
Client                              Server
  │  WS connect (Bearer auth header) │
  │ ─────────────────────────────────► │
  │                                  │
  │  run-task (task_id=UUID,         │
  │    payload.model, voice,         │
  │    format, sample_rate, input={})│
  │ ─────────────────────────────────► │
  │                                  │
  │ ◄───────────────────────────────── │  task-started (JSON event)
  │                                  │
  │  continue-task (input.text=...)  │
  │ ─────────────────────────────────► │
  │                                  │
  │ ◄───────────────────────────────── │  binary audio frame
  │ ◄───────────────────────────────── │  binary audio frame
  │ ◄───────────────────────────────── │  result-generated (JSON, optional)
  │                                  │
  │  continue-task (more text...)    │
  │ ─────────────────────────────────► │
  │ ◄───────────────────────────────── │  binary audio frame …
  │                                  │
  │  finish-task                     │
  │ ─────────────────────────────────► │
  │ ◄───────────────────────────────── │  remaining binary audio frames
  │ ◄───────────────────────────────── │  task-finished (JSON event)
  │                                  │
  │  (reuse for next task w/ new id, │
  │   or close)                      │
```

### 2.1 Instruction Schemas

**run-task** (start):
```json
{
  "header": {
    "action": "run-task",
    "task_id": "<UUID>",
    "streaming": "duplex"
  },
  "payload": {
    "task_group": "audio",
    "task": "tts",
    "function": "SpeechSynthesizer",
    "model": "cosyvoice-v3-flash",
    "parameters": {
      "text_type": "PlainText",
      "voice": "longanyang",
      "format": "mp3",
      "sample_rate": 22050,
      "volume": 50,
      "rate": 1,
      "pitch": 1,
      "enable_ssml": false
    },
    "input": {}
  }
}
```

**continue-task** (push text):
```json
{
  "header": {"action": "continue-task", "task_id": "<UUID>", "streaming": "duplex"},
  "payload": {"input": {"text": "Hello world."}}
}
```

**finish-task** (close):
```json
{
  "header": {"action": "finish-task", "task_id": "<UUID>", "streaming": "duplex"},
  "payload": {"input": {}}
}
```

### 2.2 Server Events (header.event)
| Event | Meaning | Our handler |
|---|---|---|
| `task-started` | Server accepted run-task → safe to send continue-task | Set `opened=true`, flush pending text |
| `result-generated` | Sentence-level progress marker (JSON) | Log/ignore |
| `task-finished` | All buffered audio flushed; task complete | Set `completedByProvider=true`, `finish()` |
| `task-failed` | Error; payload has `error_code`, `error_message` | `errorCb`, `finish()` |

Anything binary on the WS = audio bytes → forward to `audioCb`.

---

## 3. Models, Voices, Formats

### Models
- `cosyvoice-v3-flash` — fastest, system voices supported (longanyang, longxiaochun, etc.). **Use this for general migration.**
- `cosyvoice-v3.5-flash` / `cosyvoice-v3.5-plus` — Beijing region only, **voice clone/design required** (no system voices). Skip unless cloning.
- `cosyvoice-v2` — older, broader voice catalog.
- `qwen3-tts-flash-realtime` — different protocol; Cherry/etc voices.

### Audio Formats
- `mp3` (default, recommended for storage — matches our current Soniox config)
- `wav` (PCM container)
- `pcm` (raw)
- `opus`

### Sample Rates
- Up to 48 kHz; CosyVoice default 22050 Hz for most voices. Our Soniox config defaults to 24000 — we can pick 24000 for parity.

### Parameters
| Field | Type | Range | Notes |
|---|---|---|---|
| `voice` | string | per voice list | e.g. `longanyang` |
| `format` | enum | mp3, wav, pcm, opus | |
| `sample_rate` | int | 8000–48000 | |
| `volume` | int | 0–100 | default 50 |
| `rate` | float | 0.5–2.0 | speech rate, default 1 |
| `pitch` | float | 0.5–2.0 | default 1 |
| `enable_ssml` | bool | | requires SSML-capable voice |
| `text_type` | enum | `PlainText` or `SSML` | |

### Text Limits
- 20,000 chars per `continue-task`; 200,000 total per task.
- Chinese/Kanji/Hanja = 2 chars each; everything else = 1.

---

## 4. Mapping to Current Codebase

### File-by-file changes

**`src/modules/ai/providers/`** — add new provider, keep interface as-is:

```
providers/
  tts-provider.interface.ts           # NO CHANGE (interface fits both)
  soniox-tts.provider.ts              # KEEP for fallback / delete after migration
  alibaba-tts.provider.ts             # NEW (mirrors soniox-tts.provider.ts shape)
  alibaba-tts.provider.spec.ts        # NEW
```

The existing `TtsStreamingProvider` + `TtsStreamHandle` interface is **provider-agnostic** — `openStream({language, voice, traceId})` returns a handle with `onAudio(chunk)`/`onEnd(completed)`/`onError`/`onOpen`. No interface change needed.

**`src/modules/ai/ai.module.ts`** — swap DI binding for `TtsStreamingProvider` token from Soniox → Alibaba.

**`src/config/app-configuration.ts`** — add config keys:
```ts
ai.dashscopeApiKey       // env: DASHSCOPE_API_KEY
ai.dashscopeRegion       // 'intl' | 'cn'   (default 'intl' → Singapore)
ai.alibabaTtsModel       // default 'cosyvoice-v3-flash'
ai.alibabaTtsVoice       // default 'longanyang' (or pick per language)
ai.alibabaTtsFormat      // default 'mp3'
ai.alibabaTtsSampleRate  // default 24000
```

**`speech/tts.gateway.ts`, `speech/tts.service.ts`** — likely **no changes** since they use the interface, not the concrete provider. Verify there's no Soniox-specific assumption (e.g., base64 audio decoding) leaking out.

### Key implementation differences vs Soniox provider

1. **Two-phase open:** Cannot send text until `task-started` is received. Buffer the user's text in `pendingText` until that event fires (Soniox already buffers — same pattern, different trigger).
2. **Binary frames:** In `ws.on('message', (data, isBinary) => …)` — when `isBinary` is true, that's audio. When not binary, JSON-parse and inspect `header.event`. (Soniox uses base64-in-JSON; Alibaba flips it — simpler.)
3. **Auth via header:** Pass `Authorization: Bearer <key>` to `new WebSocket(url, {headers: {Authorization: …}})`. The `ws` package supports this.
4. **task_id management:** Generate UUID once per `openStream()`. Include in every send.
5. **Connection reuse (optional, future):** For now, 1 WS per stream is fine. Later, you can pool connections and reuse across tasks for lower handshake overhead. Pricing/quota incentive only.

---

## 5. Reference Implementation Sketch (TypeScript / NestJS)

```ts
// src/modules/ai/providers/alibaba-tts.provider.ts (excerpt)
import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const INTL_WS = 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference';
const CN_WS   = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

class AlibabaTtsStreamHandle implements TtsStreamHandle {
  private ws!: WebSocket;
  private taskId = randomUUID();
  private started = false;       // task-started received
  private pendingText: string | null = null;
  private completedByProvider = false;
  private ended = false;
  // … callbacks identical to Soniox

  connect(): this {
    this.ws = new WebSocket(this.url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'X-DashScope-DataInspection': 'enable',
      },
    });

    this.ws.on('open', () => {
      this.send({
        header: { action: 'run-task', task_id: this.taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model: this.model,
          parameters: {
            text_type: 'PlainText',
            voice: this.voice,
            format: this.audioFormat,
            sample_rate: this.sampleRate,
            volume: 50, rate: 1, pitch: 1,
            enable_ssml: false,
          },
          input: {},
        },
      });
    });

    this.ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {                       // audio frames
        if (data.length) this.audioCb?.(data);
        return;
      }
      const msg = JSON.parse(data.toString());
      const event = msg?.header?.event;
      switch (event) {
        case 'task-started':
          this.started = true;
          this.openCb?.();
          if (this.pendingText != null) {
            this.sendText(this.pendingText);
            this.pendingText = null;
            this.sendFinish();              // single-shot: text → finish immediately
          }
          break;
        case 'result-generated':
          // sentence-level progress; ignore
          break;
        case 'task-finished':
          this.completedByProvider = true;
          this.finish();
          break;
        case 'task-failed':
          this.errorCb?.(new Error(
            `Alibaba TTS task-failed: ${msg.header.error_code} ${msg.header.error_message}`
          ));
          this.finish();
          break;
      }
    });

    this.ws.on('error', err => { this.errorCb?.(err); this.finish(); });
    this.ws.on('close', () => this.finish());
    return this;
  }

  start(text: string): void {
    if (!this.started) { this.pendingText = text; return; }
    this.sendText(text);
    this.sendFinish();
  }

  private sendText(text: string): void {
    this.send({
      header: { action: 'continue-task', task_id: this.taskId, streaming: 'duplex' },
      payload: { input: { text } },
    });
  }

  private sendFinish(): void {
    this.send({
      header: { action: 'finish-task', task_id: this.taskId, streaming: 'duplex' },
      payload: { input: {} },
    });
  }

  private send(obj: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  forceClose(): void { try { this.ws.terminate(); } catch {} this.finish(); }
  // onAudio / onEnd / onError / onOpen / finish() identical to Soniox
}
```

For our single-shot use case (gateway sends one text per stream), `start(text)` → `continue-task` + `finish-task` back-to-back is the simplest mapping. If we ever want streaming text from LLM token-by-token, batch at sentence boundaries (period/question mark) before each `continue-task`.

---

## 6. Pitfalls & Gotchas

1. **Never include `Authorization` in URL query.** Server rejects. Use HTTP handshake header.
2. **Don't append `?model=...` to the inference URL** — that's the Qwen-Realtime endpoint, not CosyVoice. CosyVoice URL is fixed; model goes in `payload.model`.
3. **`input` must be `{}` (empty object) in run-task and finish-task** — omitting it gives "task can not be null" error.
4. **Single task_id per synthesis** — generate once, reuse for continue/finish. Different task_ids across instructions cause buffer misalignment, missing `task-finished`, or billing errors.
5. **Always send `finish-task`** — otherwise trailing buffered audio is lost. (Soniox auto-flushes on `text_end: true`; Alibaba requires explicit finish.)
6. **WS lifecycle:** do not close before `task-finished`. If you close on transport error before that event, treat audio as **incomplete** (mirror our existing `completedByProvider` flag — only cache when event fires).
7. **Region choice:** Singapore (`dashscope-intl`) for international users; Beijing (`dashscope`) only if your data plane is in mainland China. Different API key per region (DashScope intl vs CN consoles).
8. **`X-DashScope-DataInspection: enable`** triggers content moderation. Keep it on by default; expect occasional `task-failed` with policy violation codes.
9. **MP3 frame boundaries:** binary frames are not guaranteed to align to MP3 frame boundaries — keep accumulating, decode at end (this is how our code already works).
10. **Voice ↔ model coupling:** Each voice belongs to a specific model version. `longanyang` works on `cosyvoice-v3-flash`, not on `cosyvoice-v2` (which uses `longxiaochun_v2` etc.). Verify with the voice list when picking.
11. **No HTTP fallback for CosyVoice realtime.** If you want a non-streaming REST path for short utterances, use the separate "Speech synthesis - Qwen" HTTP API or Qwen-TTS Realtime HTTP — different model, different module. Our current `synthesize()` (non-stream) method would need a separate implementation.

---

## 7. Migration Checklist

- [ ] Add `DASHSCOPE_API_KEY`, `DASHSCOPE_REGION` to `.env.example` + Railway env.
- [ ] Add config keys in `app-configuration.ts`.
- [ ] Create `alibaba-tts.provider.ts` + spec, modeled on `soniox-tts.provider.ts`.
- [ ] Implement `synthesize()` (non-stream) — also via WS (one task, single continue+finish, concat binary). No REST option.
- [ ] Wire DI in `ai.module.ts` (swap provider binding for `TtsStreamingProvider`).
- [ ] Run `npm run build` — confirm zero TS errors before push.
- [ ] Run existing `tts.service.spec.ts` / `tts.gateway` integration tests against the new provider.
- [ ] Smoke test: open WS, run-task, receive `task-started`, send continue+finish, receive binary frames, receive `task-finished`. Verify MP3 plays end-to-end.
- [ ] Verify partial-close behavior: kill WS mid-stream → `completedByProvider=false` → audio NOT cached.
- [ ] Pick default `voice` per UI `language`: e.g., English → suitable English-supporting CosyVoice voice; Vietnamese → check voice list (CosyVoice v3.5 covers VI in instruction text; verify voice-level support for speech output).
- [ ] Update docs: `docs/codebase-summary.md` (provider list), `docs/api-documentation.md` if any TTS endpoints changed.
- [ ] Keep Soniox provider in tree until Alibaba runs 1 week stable; then delete.

---

## 8. References

- Realtime TTS user guide: https://www.alibabacloud.com/help/en/model-studio/realtime-tts-user-guide
- CosyVoice WebSocket API reference: https://www.alibabacloud.com/help/en/model-studio/cosyvoice-websocket-api
- Qwen-TTS Realtime API reference: https://www.alibabacloud.com/help/en/model-studio/qwen-tts-realtime-api
- Voice lists, pricing, model selection: linked from the user guide page.

---

## Confirmed Decisions (2026-05-19)

1. **Voice:** single default voice — no per-language mapping. Use one CosyVoice system voice (e.g., `longanyang` on `cosyvoice-v3-flash`) via `ai.alibabaTtsVoice` config, same shape as current Soniox `ai.sonioxTtsVoice = "Adrian"`.
2. **Region:** Singapore only → `wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference`. Use DashScope International API key. Skip CN/Beijing endpoint entirely (no region toggle needed).
3. **Skip Qwen-TTS** — CosyVoice only. Single provider, single protocol.
4. **Skip pricing analysis** — proceed on functional parity.
5. **Skip voice cloning** — system voices only. Stick to `cosyvoice-v3-flash` (no v3.5-*, no Beijing lock).

### Simplified config keys
```ts
ai.dashscopeApiKey       // env: DASHSCOPE_API_KEY
ai.alibabaTtsModel       // default 'cosyvoice-v3-flash'
ai.alibabaTtsVoice       // default 'longanyang' (or pick another from CosyVoice voice list)
ai.alibabaTtsFormat      // default 'mp3'
ai.alibabaTtsSampleRate  // default 24000
```
Hardcode the SG endpoint constant in the provider — no region toggle.

## Unresolved Questions

None — ready to implement.
