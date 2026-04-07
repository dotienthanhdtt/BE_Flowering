# Phase 3: Controller + DTOs + Module Wiring

## Context
- [Phase 2: Transcription Service](./phase-02-transcription-service.md)
- [AiController](../../src/modules/ai/ai.controller.ts)
- [AiModule](../../src/modules/ai/ai.module.ts)
- [DTO Index](../../src/modules/ai/dto/index.ts)

## Overview
- **Priority**: High
- **Status**: Pending
- **Description**: Add `POST /ai/transcribe` endpoint to AiController, create DTOs, wire providers/service into AiModule.

## Requirements
- Multipart/form-data upload via `@UseInterceptors(FileInterceptor('audio'))`
- Accept optional `conversation_id` as form field
- Return standard `{ code: 1, data: { text } }` response (via existing interceptor)
- Swagger docs with `@ApiConsumes('multipart/form-data')`

## Related Code Files

### Files to Create
| File | Purpose |
|------|---------|
| `src/modules/ai/dto/transcribe.dto.ts` | Request + response DTOs |

### Files to Modify
| File | Change |
|------|--------|
| `src/modules/ai/ai.controller.ts` | Add `transcribe()` endpoint |
| `src/modules/ai/ai.module.ts` | Register STT providers + TranscriptionService + import DatabaseModule |
| `src/modules/ai/dto/index.ts` | Export transcribe DTOs |

## Implementation Steps

### 1. Create `transcribe.dto.ts`
```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class TranscribeRequestDto {
  @ApiPropertyOptional({ description: 'Onboarding conversation ID for context' })
  @IsOptional()
  @IsUUID()
  conversation_id?: string;
}

export class TranscribeResponseDto {
  @ApiProperty({ description: 'Transcribed text from audio' })
  text!: string;
}
```

### 2. Update `dto/index.ts`
Add: `export * from './transcribe.dto';`

### 3. Update `ai.controller.ts`
Add imports and endpoint:
```typescript
import { UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';

@Post('transcribe')
@ApiOperation({ summary: 'Transcribe audio to text' })
@ApiConsumes('multipart/form-data')
@ApiResponse({ status: 200, type: TranscribeResponseDto })
@UseInterceptors(FileInterceptor('audio'))
async transcribe(
  @CurrentUser() user: User,
  @UploadedFile() file: Express.Multer.File,
  @Body() dto: TranscribeRequestDto,
): Promise<TranscribeResponseDto> {
  const result = await this.transcriptionService.transcribe(file, user.id);
  return { text: result.text };
}
```
- Inject `TranscriptionService` in constructor
- Note: `@RequirePremium()` already applied at class level — endpoint requires premium

### 4. Update `ai.module.ts`
```typescript
// Add imports
import { OpenAiSttProvider } from './providers/openai-stt.provider';
import { GeminiSttProvider } from './providers/gemini-stt.provider';
import { TranscriptionService } from './services/transcription.service';
import { DatabaseModule } from '../../database/database.module';

// Add to imports array: DatabaseModule (for SupabaseStorageService)
// Add to providers array: OpenAiSttProvider, GeminiSttProvider, TranscriptionService
```

## Todo List
- [ ] Create `transcribe.dto.ts` with TranscribeRequestDto + TranscribeResponseDto
- [ ] Export from `dto/index.ts`
- [ ] Add `POST /ai/transcribe` to AiController with FileInterceptor
- [ ] Wire providers + service in AiModule
- [ ] Ensure DatabaseModule exports SupabaseStorageService (or import directly)
- [ ] Verify compile with `npm run build`
- [ ] Test via Swagger UI or curl

## Success Criteria
- `POST /ai/transcribe` accepts multipart form with `audio` file + optional `conversation_id`
- Returns `{ code: 1, message: "Success", data: { text: "..." } }` via interceptor
- Swagger docs show file upload UI
- 401 without JWT, 400 without file or invalid format

## Security Considerations
- JWT required (global guard, no `@Public()`)
- Premium required (class-level `@RequirePremium()`)
- File size capped at 10MB (validated in service)
- MIME type validated before processing
