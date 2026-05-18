# Voice API — Client Migration Reference

End-to-end client reference for the voice loop: **STT** (speech → text) and **TTS** (text → speech). Two surfaces each: REST one-shot + WebSocket streaming.

**Audience:** Mobile (Flutter) and any client consuming voice endpoints.
**Base URL (dev):** `https://<dev-host>` (HTTP) / `wss://<dev-host>` (WS)
**Base URL (prod):** `https://<prod-host>` / `wss://<prod-host>`

All REST responses use the standard wrapper:
```json
{ "code": 1, "message": "Success", "data": { ... } }
```

---

## Voice Loop Overview

```
┌──────────┐      ┌─────────┐      ┌─────────┐      ┌──────────┐
│  Client  │─PCM─▶│  STT WS │─txt─▶│   LLM   │─txt─▶│  TTS REST│─url─▶ Client plays mp3
│ (mic)    │      │ /stt    │      │ /chat   │      │ /tts     │
└──────────┘      └─────────┘      └─────────┘      └──────────┘
                                                          ▲
                                                          │ same Langfuse trace via traceId
```

`traceId` (UUID v4 minted by client) ties STT + LLM + TTS into a single Langfuse session — pass it through every call in one turn.

---

## Authentication

| Context | Mechanism | Where to send |
|---------|-----------|---------------|
| **Scenario** (logged-in user) | JWT | `Authorization: Bearer <jwt>` header **or** `?token=<jwt>` query (WS) |
| **Onboarding** (anonymous) | `sessionId` (UUID v4) | `?sessionId=<uuid>` query (WS) or request body field (REST) |

---

# STT — Speech-to-Text

## 1. STT WebSocket — `wss://host/ws/speech/stt`

Realtime streaming STT. Mobile streams raw PCM 16-bit 16 kHz mono frames; backend forwards partial/final transcripts.

### Connect

**Scenario:**
```
wss://host/ws/speech/stt?context=scenario&traceId=<uuid>&lang=en&token=<jwt>
```

**Onboarding:**
```
wss://host/ws/speech/stt?context=onboarding&traceId=<uuid>&lang=en&sessionId=<uuid>
```

| Query Param | Required | Notes |
|-------------|----------|-------|
| `context` | yes | `scenario` or `onboarding` |
| `traceId` | recommended | UUID v4 — also pass to chat+tts so Langfuse links them |
| `lang` | no | ISO 639-1 hint (`en`, `vi`, …) |
| `token` | scenario | JWT (or `Authorization` header) |
| `sessionId` | onboarding | Onboarding session UUID |

### Audio format
Raw PCM, **16-bit signed, 16 kHz, mono**, no header. ~4 KB chunks recommended.

### Protocol
```
Client → Server                            Server → Client
─────────────────────────────────────────────────────────────────
[binary PCM frames]                  →
                                     ←     {type:"partial", text:"hel"}
                                     ←     {type:"partial", text:"hello"}
                                     ←     {type:"final",   text:"hello world"}
{type:"end"}                         →
                                     ←     {type:"session_end",
                                            transcript:"hello world",
                                            audioUrl:"https://...wav",
                                            traceId:"<uuid>"}
                                           [close 1000]
```

### Server → Client messages
```ts
type ServerMsg =
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "session_end"; transcript: string; audioUrl: string | null; traceId: string }
  | { type: "error"; code: "max_duration"|"overflow"|"provider"|"auth"|"concurrent"; message: string }
```

### Close codes
| Code | Meaning |
|------|---------|
| 1000 | Normal close after `session_end` |
| 4401 | Unauthorized |
| 4408 | Max duration (3 min) exceeded |
| 4413 | Audio buffer overflow (> 5.76 MB) |
| 4429 | Concurrent session already active for this principal |
| 4500 | Provider (Soniox) error |
| 4503 | Provider closed connection |

### Limits
- **Max duration:** 3 min per session
- **Max buffer:** 5.76 MB (~3 min of 16 kHz 16-bit PCM)
- **One active session per principal** — overlapping connects get 4429

### `traceId` re-use
After `session_end`, pass the same `traceId` to the chat request and any downstream TTS call so all three appear in one Langfuse session.

---

# TTS — Text-to-Speech

Mobile triggers synthesis on demand using a `messageId` (assistant chat message UUID). The first call invokes Soniox; subsequent calls hit a per-message DB cache and return a fresh presigned URL with no extra billing.

Only **assistant-role** messages can be synthesized. **Max 5000 chars.**

## 2. TTS REST (scenario) — `POST /ai/speech/tts`

**Auth:** JWT bearer.

### Request
```http
POST /ai/speech/tts HTTP/1.1
Authorization: Bearer <jwt>
Content-Type: application/json

{ "messageId": "550e8400-e29b-41d4-a716-446655440000" }
```

### Response (200)
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "audioUrl": "https://<bucket>.r2.dev/...signed-mp3",
    "mimeType": "audio/mpeg",
    "cached": false
  }
}
```

`cached: true` ⇒ DB-cached hit; URL re-signed (valid 1h); Soniox not called.

### Errors
| Status | Reason |
|--------|--------|
| 400 | Message > 5000 chars |
| 403 | Not an assistant message **or** conversation isn't yours |
| 404 | `messageId` not found |
| 502 | Soniox error |

## 3. TTS REST (onboarding) — `POST /ai/speech/tts/onboarding`

**Auth:** none (public). Server verifies:
- `messageId` belongs to `conversationId`
- `conversationId.type` ∈ {`anonymous`, `personalize_intake`}
- conversation has no linked `userId`

### Request
```json
{
  "messageId": "<uuid>",
  "conversationId": "<uuid>",
  "sessionId": "<uuid>"
}
```

Response shape identical to scenario endpoint.

## 4. TTS WebSocket — `wss://host/ws/speech/tts`

Streaming TTS — server emits binary mp3 chunks as Soniox generates them. Lower time-to-first-audio for long replies.

### Connect

**Scenario:**
```
wss://host/ws/speech/tts?context=scenario&messageId=<uuid>&token=<jwt>
```

**Onboarding:**
```
wss://host/ws/speech/tts?context=onboarding&messageId=<uuid>&conversationId=<uuid>&sessionId=<uuid>
```

| Query Param | Required | Notes |
|-------------|----------|-------|
| `context` | yes | `scenario` or `onboarding` |
| `messageId` | yes | Assistant message UUID to synthesize |
| `conversationId` | onboarding | Conversation the message belongs to |
| `sessionId` | onboarding | Onboarding session UUID |
| `token` | scenario | JWT (or `Authorization` header) |

### Protocol
```
Client → Server                            Server → Client
─────────────────────────────────────────────────────────────────
[connect + handshake]                →
                                     ←     [binary mp3 chunk #1]
                                     ←     [binary mp3 chunk #2]
                                     ←     ...
                                     ←     {type:"session_end",
                                            first_chunk_ms: 240,
                                            total_bytes: 31480}
                                           [close 1000]
```

### Audio format
Default **mp3**. Configurable via backend env if mobile needs `pcm_s16le` for universal player support.

### Behaviour
- **Cache hit:** if the message was synthesized before, server streams the stored mp3 once and closes — Soniox is not called.
- **Cache miss:** server proxies Soniox WS; after the stream ends, the audio is uploaded + persisted so the next call is a cache hit.

### Close codes
| Code | Reason |
|------|--------|
| 1000 | Normal close after `session_end` |
| 4400 | Missing/invalid `messageId` or `conversationId` |
| 4401 | Unauthorized |
| 4403 | Forbidden (not your message / wrong conversation / not onboarding) |
| 4404 | Message not found |
| 4408 | Max duration (60s) exceeded |
| 4413 | Message > 5000 chars |
| 4500 | Provider (Soniox) error |

### Limits
- **Max duration:** 60s per session
- **Text cap:** 5000 chars (same as REST)

---

## Mobile Integration Cheatsheet

### One voice turn (scenario)

```dart
// 1. mint shared trace id
final traceId = const Uuid().v4();

// 2. open STT WS, push PCM, send {"type":"end"}, read transcript
final transcript = await openSttStream(
  url: 'wss://host/ws/speech/stt?context=scenario&traceId=$traceId&lang=en&token=$jwt',
  pcmStream: micPcmStream,
);

// 3. call chat with traceId so LLM joins same Langfuse session
final reply = await http.post(
  '/ai/scenarios/$scenarioId/chat',
  headers: {'Authorization': 'Bearer $jwt'},
  body: jsonEncode({'message': transcript, 'traceId': traceId}),
);
final messageId = reply.data.assistantMessageId;

// 4a. simple — REST TTS
final tts = await http.post(
  '/ai/speech/tts',
  headers: {'Authorization': 'Bearer $jwt'},
  body: jsonEncode({'messageId': messageId}),
);
await audioPlayer.play(UrlSource(tts.data.audioUrl));

// 4b. faster first-audio — WS TTS
final ws = WebSocketChannel.connect(Uri.parse(
  'wss://host/ws/speech/tts?context=scenario&messageId=$messageId&token=$jwt',
));
ws.stream.listen((frame) { /* feed bytes to streaming audio player */ });
```

### One voice turn (onboarding)

Replace JWT with `sessionId` (UUID v4) and add `conversationId` (returned by `POST /onboarding/chat`) on every voice call. Everything else is identical.

---

## Migration Notes

- **`audioUrl` field naming:**
  - `session_end.audioUrl` (STT) → user-recorded **input** (stored as wav)
  - `tts.audioUrl` (TTS REST response) → AI-spoken **output** (mp3)
  - DB has two distinct columns: `audio_url` (STT) and `tts_audio_path` (TTS object key)
- **Cache invariant:** repeated TTS calls on the same `messageId` ⇒ no Soniox bill, fresh 1h signed URL each time. Safe to call on every replay tap.
- **5000-char cap:** chat replies are gated; if exceeded, ask LLM for a shorter version client-side rather than retrying TTS.
- **`traceId` flow:** mint once at mic-press; pass to STT, chat (`traceId` in body), and TTS calls. Backend defaults it to `messageId` if you omit it on TTS, but you lose cross-event linkage.

---

## Unresolved Questions

- Confirm Flutter `just_audio` (or alternative) reliably plays chunked mp3 from a WebSocket source. If not, mobile asks backend ops to flip `SONIOX_TTS_AUDIO_FORMAT=pcm_s16le`.
- Measure first-audio-ms on TTS WS vs REST during integration; if WS gain < 100 ms for typical reply length, prefer REST for simplicity.
