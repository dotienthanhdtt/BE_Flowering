# Phase 4: Testing

## Context
- [Phase 3: Controller + DTOs](./phase-03-controller-dtos-wiring.md)
- [Existing Test Pattern](../../test/)

## Overview
- **Priority**: Medium
- **Status**: Pending
- **Description**: Unit tests for TranscriptionService (validation, provider routing, fallback) and STT providers.

## Requirements
- Test file validation (size, MIME type)
- Test provider selection logic (env var, fallback)
- Test fallback behavior when primary fails
- Test controller integration (file upload, auth)

## Related Code Files

### Files to Create
| File | Purpose |
|------|---------|
| `src/modules/ai/services/transcription.service.spec.ts` | Service unit tests |
| `src/modules/ai/providers/openai-stt.provider.spec.ts` | OpenAI provider tests |
| `src/modules/ai/providers/gemini-stt.provider.spec.ts` | Gemini provider tests |

## Implementation Steps

### 1. `transcription.service.spec.ts`
Test cases:
- `validateFile()` rejects missing file → BadRequestException
- `validateFile()` rejects file > 10MB → BadRequestException
- `validateFile()` rejects unsupported MIME type → BadRequestException
- `validateFile()` accepts valid audio files
- `transcribe()` calls uploadAudio before transcription
- `transcribe()` uses configured provider (openai/gemini)
- `transcribe()` falls back to secondary when primary fails
- `transcribe()` throws when no provider available

### 2. `openai-stt.provider.spec.ts`
- `isAvailable()` returns false when no API key
- `isAvailable()` returns true when API key present
- `transcribe()` calls OpenAI Whisper API with correct params
- `transcribe()` throws ServiceUnavailableException on API error

### 3. `gemini-stt.provider.spec.ts`
- `isAvailable()` returns false when no API key
- `isAvailable()` returns true when API key present
- `transcribe()` sends base64 audio to Gemini
- `transcribe()` throws ServiceUnavailableException on API error

## Todo List
- [ ] Write TranscriptionService unit tests
- [ ] Write OpenAI STT provider unit tests
- [ ] Write Gemini STT provider unit tests
- [ ] Run `npm test` — all pass
- [ ] Run `npm run build` — compiles clean

## Success Criteria
- All tests pass with `npm test`
- Coverage on new files > 80%
- No mocking of actual audio content — mock the SDK clients only
