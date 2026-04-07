# Phase 1: STT Provider Interface + Implementations

## Context
- [Brainstorm Report](../reports/brainstorm-260407-0031-ai-transcribe-endpoint.md)
- [LLM Provider Pattern](../../src/modules/ai/providers/llm-provider.interface.ts)
- [OpenAI LLM Provider](../../src/modules/ai/providers/openai-llm.provider.ts)
- [Gemini LLM Provider](../../src/modules/ai/providers/gemini-llm.provider.ts)

## Overview
- **Priority**: High
- **Status**: Pending
- **Description**: Create `SttProvider` interface and two implementations (OpenAI Whisper, Gemini multimodal) following the existing `LLMProvider` pattern.

## Key Insights
- `openai@^4.104.0` already in deps — has `openai.audio.transcriptions.create()` for Whisper
- `@langchain/google-genai` already in deps — Gemini supports audio as `HumanMessage` with inline data
- Follow same Injectable + ConfigService + Logger pattern as `openai-llm.provider.ts`
- No LangChain abstraction for STT exists — use native SDKs directly

## Requirements
- `SttProvider` interface with `transcribe()`, `isAvailable()`, `name`
- OpenAI provider: use Whisper API via `openai` SDK
- Gemini provider: use `@google/generative-ai` (already bundled via `@langchain/google-genai`) or REST

## Related Code Files

### Files to Create
| File | Purpose |
|------|---------|
| `src/modules/ai/providers/stt-provider.interface.ts` | Interface + types |
| `src/modules/ai/providers/openai-stt.provider.ts` | Whisper implementation |
| `src/modules/ai/providers/gemini-stt.provider.ts` | Gemini multimodal implementation |

## Implementation Steps

### 1. Create `stt-provider.interface.ts`
```typescript
export interface SttResult {
  text: string;
}

export interface SttOptions {
  language?: string;
}

export interface SttProvider {
  readonly name: string;
  transcribe(audio: Buffer, mimeType: string, options?: SttOptions): Promise<SttResult>;
  isAvailable(): boolean;
}
```

### 2. Create `openai-stt.provider.ts`
- `@Injectable()`, inject `ConfigService<AppConfiguration>`
- `isAvailable()`: check `ai.openaiApiKey` exists
- `transcribe()`:
  ```typescript
  import OpenAI from 'openai';
  // Convert Buffer to File object for Whisper API
  const file = new File([audio], 'audio.m4a', { type: mimeType });
  const client = new OpenAI({ apiKey });
  const result = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    ...(options?.language && { language: options.language }),
  });
  return { text: result.text };
  ```
- Wrap in try-catch, log errors, throw `ServiceUnavailableException`

### 3. Create `gemini-stt.provider.ts`
- `@Injectable()`, inject `ConfigService<AppConfiguration>`
- `isAvailable()`: check `ai.googleAiApiKey` exists
- `transcribe()`:
  ```typescript
  import { GoogleGenerativeAI } from '@google/generative-ai';
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent([
    { inlineData: { mimeType, data: audio.toString('base64') } },
    'Transcribe this audio accurately. Return only the transcribed text, nothing else.',
  ]);
  return { text: result.response.text().trim() };
  ```
- Wrap in try-catch, log errors, throw `ServiceUnavailableException`

## Todo List
- [ ] Create `stt-provider.interface.ts` with SttProvider, SttResult, SttOptions
- [ ] Create `openai-stt.provider.ts` using OpenAI SDK Whisper API
- [ ] Create `gemini-stt.provider.ts` using Google Generative AI SDK
- [ ] Verify both compile with `npm run build`

## Success Criteria
- Both providers implement `SttProvider` interface
- `isAvailable()` returns false when API key missing (no crash)
- Error handling follows existing provider pattern (Logger + ServiceUnavailableException)

## Risk Assessment
- **Gemini STT accuracy**: LLM-based transcription less reliable than dedicated STT; mitigated by using as fallback only
- **`@google/generative-ai` availability**: Bundled as transitive dep of `@langchain/google-genai`; verify import works
