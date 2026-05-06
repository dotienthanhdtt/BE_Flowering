# Brainstorm: POST /ai/transcribe Endpoint

---
type: brainstorm
date: 2026-04-07
status: approved
---

## Problem Statement

iOS client records audio during on-device STT. Need backend endpoint to produce more accurate transcription via cloud STT providers. Fire-and-forget pattern — client keeps on-device result if backend fails.

## Requirements

- Accept multipart/form-data with `audio` file (M4A, max 10MB) and optional `conversation_id`
- Multi-provider STT abstraction (OpenAI Whisper + Gemini multimodal initially)
- Persist audio in Supabase storage before transcription
- Return `{ code: 1, data: { text: "..." } }` standard response
- JWT-protected (global guard)
- No conversation context needed for transcription accuracy

## Evaluated Approaches

### A. Single Provider (OpenAI Whisper only)
- **Pros**: Simplest, Whisper is best-in-class STT, native m4a support
- **Cons**: Vendor lock-in, no fallback if OpenAI is down
- **Verdict**: Too rigid for a multi-provider codebase

### B. Multi-Provider Abstraction (Chosen)
- **Pros**: Consistent with existing `unified-llm.service` pattern, fallback capability, provider-agnostic
- **Cons**: Slightly more boilerplate upfront
- **Verdict**: Best fit — mirrors existing architecture

### C. Direct Gemini Multimodal Only
- **Pros**: Reuses existing LangChain Gemini provider
- **Cons**: LLM-based STT less reliable than dedicated STT engines, higher latency
- **Verdict**: Good as secondary/fallback, not primary

## Recommended Solution

### Architecture

```
AiController (POST /ai/transcribe)
  └─ TranscriptionService (routing + orchestration)
       ├─ OpenAiSttProvider (Whisper API)
       ├─ GeminiSttProvider (multimodal audio input)
       └─ SupabaseStorageService (persist audio)
```

### New Files

| File | Purpose |
|------|---------|
| `src/modules/ai/providers/stt-provider.interface.ts` | `SttProvider` interface |
| `src/modules/ai/providers/openai-stt.provider.ts` | Whisper API implementation |
| `src/modules/ai/providers/gemini-stt.provider.ts` | Gemini multimodal implementation |
| `src/modules/ai/services/transcription.service.ts` | Provider routing, validation, storage orchestration |
| `src/modules/ai/dto/transcribe.dto.ts` | Request/response DTOs |

### Modified Files

| File | Change |
|------|--------|
| `src/modules/ai/ai.controller.ts` | Add POST /ai/transcribe with FileInterceptor |
| `src/modules/ai/ai.module.ts` | Register providers + TranscriptionService |

### Provider Interface

```typescript
interface SttProvider {
  readonly name: string;
  transcribe(audio: Buffer, mimeType: string, options?: SttOptions): Promise<SttResult>;
  isAvailable(): boolean;
}

interface SttResult { text: string }
interface SttOptions { language?: string }
```

### Provider Selection

- Env var `STT_PROVIDER=openai|gemini` (default: `openai`)
- `isAvailable()` checks if API key configured
- Optional fallback to secondary if primary fails

### Request Flow

1. Multer extracts `audio` file, validates type + 10MB limit
2. `SupabaseStorageService.uploadAudio(buffer, userId, filename)` persists file
3. `TranscriptionService.transcribe(buffer, mimeType)` routes to active provider
4. Return standard response wrapper with transcribed text

### Validation

- Accepted MIME types: `audio/x-m4a`, `audio/mp4`, `audio/mpeg`, `audio/wav`
- Max size: 10MB (~5 min M4A at 128kbps)
- 400 error if no file or invalid format

## Risks

| Risk | Mitigation |
|------|------------|
| Upload timeout on slow mobile | 10MB limit + client pre-compression (128kbps) |
| Provider API failure | Fallback provider; client keeps on-device STT |
| Storage cost growth | Audio small (~100KB/min); add TTL cleanup later if needed |
| No new npm packages needed | OpenAI SDK already in deps; Gemini via LangChain |

## Success Metrics

- Endpoint returns accurate transcription for M4A audio
- Provider abstraction allows swapping/adding STT providers via config
- Audio persisted in Supabase before transcription attempt
- Inherits existing rate limiting (20 req/min, 100 req/hr)

## Next Steps

- Create implementation plan via `/ck:plan`
- Implement in phases: interface → providers → service → controller → tests
