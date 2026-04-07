---
status: completed
branch: feat/implement-home
brainstorm: plans/reports/brainstorm-260407-0031-ai-transcribe-endpoint.md
blockedBy: []
blocks: []
---

# POST /ai/transcribe — Multi-Provider STT

## Overview
Add audio transcription endpoint to AiController with abstract multi-provider STT (OpenAI Whisper + Gemini multimodal). Accepts M4A upload, persists to Supabase, returns transcribed text.

## Phases

| # | Phase | Status | Effort |
|---|-------|--------|--------|
| 1 | STT provider interface + implementations | completed | M |
| 2 | Transcription service + config | completed | M |
| 3 | Controller endpoint + DTOs + module wiring | completed | S |
| 4 | Testing | completed | M |

## Key Dependencies
- Existing: `openai@^4.104.0`, `@langchain/google-genai`, `SupabaseStorageService`
- No new npm packages required
- Env vars: `STT_PROVIDER`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`

## Architecture
```
POST /ai/transcribe (multipart/form-data)
  → AiController.transcribe()
    → Multer extracts audio file (max 10MB)
    → SupabaseStorageService.uploadAudio() persists file
    → TranscriptionService.transcribe() routes to provider
      → OpenAiSttProvider | GeminiSttProvider
    → Return { code: 1, data: { text: "..." } }
```

## Phase Files
- [Phase 1: STT Providers](./phase-01-stt-providers.md)
- [Phase 2: Transcription Service](./phase-02-transcription-service.md)
- [Phase 3: Controller + DTOs + Wiring](./phase-03-controller-dtos-wiring.md)
- [Phase 4: Testing](./phase-04-testing.md)
