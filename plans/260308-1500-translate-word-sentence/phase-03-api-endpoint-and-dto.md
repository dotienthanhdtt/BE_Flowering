# Phase 3: API Endpoint & DTO

## Context Links
- [Plan overview](plan.md)
- [Phase 2: Translation service](phase-02-translation-service-and-prompts.md)
- Controller patterns: `src/modules/ai/ai.controller.ts`
- DTO patterns: `src/modules/ai/dto/chat.dto.ts`

## Overview
- **Priority:** High
- **Status:** Complete
- **Description:** Create translate DTO and add POST /ai/translate endpoint to controller
- **Completed:** 2026-03-08

## Requirements
- TranslateRequestDto with type discriminator + validation
- POST /ai/translate endpoint on AiController
- Swagger documentation
- Rate limiting (existing ThrottlerGuard)

## Related Code Files

**Create:**
- `src/modules/ai/dto/translate-request.dto.ts`

**Modify:**
- `src/modules/ai/ai.controller.ts` — add translate endpoint
- `src/modules/ai/dto/index.ts` — export new DTO

## Implementation Steps

1. Create `translate-request.dto.ts`:
   ```typescript
   export enum TranslateType {
     WORD = 'word',
     SENTENCE = 'sentence',
   }

   export class TranslateRequestDto {
     @ApiProperty({ enum: TranslateType })
     @IsEnum(TranslateType)
     type!: TranslateType;

     @ApiPropertyOptional({ description: 'Word to translate (required for type=word)' })
     @IsString()
     @IsOptional()
     @MaxLength(255)
     text?: string;

     @ApiPropertyOptional({ description: 'Message ID (required for type=sentence)' })
     @IsUUID()
     @IsOptional()
     messageId?: string;

     @ApiProperty({ example: 'en' })
     @IsString()
     @MaxLength(10)
     sourceLang!: string;

     @ApiProperty({ example: 'vi' })
     @IsString()
     @MaxLength(10)
     targetLang!: string;
   }
   ```

2. Add custom validation: if type=word, text required; if type=sentence, messageId required

3. Update `dto/index.ts`: add export

4. Update `ai.controller.ts`:
   - Import TranslationService in constructor
   - Add `@Post('translate')` endpoint
   - Validate type-specific required fields
   - Route to translateWord or translateSentence
   - Return result

## Todo List
- [x] Create translate-request DTO with validation
- [x] Add translate endpoint to controller
- [x] Export DTO from index
- [x] Verify Swagger docs render correctly
- [x] Verify build: `npm run build`
- [x] Fix DTO validation for type-conditional required fields

## Success Criteria
- DTO validates all fields correctly
- Type-conditional validation works (text for word, messageId for sentence)
- Swagger shows endpoint with proper schema
- Rate limiting applied via existing ThrottlerGuard
- Response wrapped in {code, message, data}

## Risk Assessment
- Conditional validation: class-validator doesn't natively support conditional required → validate manually in controller or use @ValidateIf

## Next Steps
→ Phase 4: Testing
