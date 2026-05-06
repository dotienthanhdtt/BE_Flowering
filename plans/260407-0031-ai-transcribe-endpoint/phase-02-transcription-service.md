# Phase 2: Transcription Service + Config

## Context
- [Phase 1: STT Providers](./phase-01-stt-providers.md)
- [Unified LLM Service Pattern](../../src/modules/ai/services/unified-llm.service.ts)
- [App Configuration](../../src/config/app-configuration.ts)
- [Supabase Storage](../../src/database/supabase-storage.service.ts)

## Overview
- **Priority**: High
- **Status**: Pending
- **Description**: Create `TranscriptionService` that orchestrates provider selection, file validation, Supabase storage, and transcription routing. Add `STT_PROVIDER` env var to config.

## Requirements
- Route to correct STT provider based on `STT_PROVIDER` env var
- Validate audio file (MIME type, size)
- Persist audio to Supabase before transcription
- Fallback to secondary provider if primary fails

## Related Code Files

### Files to Create
| File | Purpose |
|------|---------|
| `src/modules/ai/services/transcription.service.ts` | Orchestration service |

### Files to Modify
| File | Change |
|------|--------|
| `src/config/app-configuration.ts` | Add `ai.sttProvider` field |
| `.env.example` | Add `STT_PROVIDER=openai` |

## Implementation Steps

### 1. Update `app-configuration.ts`
Add to `ai` section:
```typescript
ai: {
  // ...existing fields...
  sttProvider: string;  // 'openai' | 'gemini'
}
// In the factory:
ai: {
  // ...existing...
  sttProvider: process.env.STT_PROVIDER || 'openai',
}
```

### 2. Update `.env.example`
Add:
```
STT_PROVIDER=openai
```

### 3. Create `transcription.service.ts`
```typescript
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly maxFileSize = 10 * 1024 * 1024; // 10MB
  private readonly allowedMimeTypes = [
    'audio/x-m4a', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/m4a',
  ];

  constructor(
    private configService: ConfigService<AppConfiguration>,
    private openaiStt: OpenAiSttProvider,
    private geminiStt: GeminiSttProvider,
    private storageService: SupabaseStorageService,
  ) {}

  private getProvider(): SttProvider {
    const preferred = this.configService.get('ai.sttProvider', { infer: true });
    const primary = preferred === 'gemini' ? this.geminiStt : this.openaiStt;
    if (primary.isAvailable()) return primary;
    // Fallback
    const fallback = preferred === 'gemini' ? this.openaiStt : this.geminiStt;
    if (fallback.isAvailable()) return fallback;
    throw new ServiceUnavailableException('No STT provider available');
  }

  validateFile(file: Express.Multer.File): void {
    if (!file) throw new BadRequestException('Audio file is required');
    if (file.size > this.maxFileSize) throw new BadRequestException('File exceeds 10MB limit');
    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported audio format: ${file.mimetype}`);
    }
  }

  async transcribe(file: Express.Multer.File, userId: string): Promise<SttResult> {
    this.validateFile(file);

    // 1. Persist audio
    await this.storageService.uploadAudio(file.buffer, userId, file.originalname);

    // 2. Transcribe via provider
    const provider = this.getProvider();
    this.logger.log(`Transcribing with ${provider.name} for user ${userId}`);

    try {
      return await provider.transcribe(file.buffer, file.mimetype);
    } catch (error) {
      // Try fallback if primary fails
      const fallback = provider === this.openaiStt ? this.geminiStt : this.openaiStt;
      if (fallback.isAvailable()) {
        this.logger.warn(`${provider.name} failed, falling back to ${fallback.name}`);
        return await fallback.transcribe(file.buffer, file.mimetype);
      }
      throw error;
    }
  }
}
```

## Todo List
- [ ] Add `sttProvider` to `AppConfiguration` interface and factory
- [ ] Add `STT_PROVIDER=openai` to `.env.example`
- [ ] Create `transcription.service.ts` with validation, storage, routing, fallback
- [ ] Verify compile with `npm run build`

## Success Criteria
- Provider selected from `STT_PROVIDER` env var with automatic fallback
- File validation rejects oversized/wrong-format files with 400
- Audio persisted to Supabase before transcription attempt
- Graceful fallback: if primary provider fails, try secondary

## Risk Assessment
- **SupabaseStorageService not in AiModule**: Currently in DatabaseModule — need to import or make available. Check if globally exported.
