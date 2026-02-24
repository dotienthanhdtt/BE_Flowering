# Phase 02: Onboarding Module Setup

## Context Links
- [Parent Plan](./plan.md)
- [Phase 01 (dependency)](./phase-01-database-migration.md)
- [Code Standards](../../docs/code-standards.md)
- [AI Module Pattern](../../src/modules/ai/ai.module.ts)
- [App Module](../../src/app.module.ts)

## Overview
- **Priority:** P1
- **Status:** complete
- **Effort:** 0.5h
- **Description:** Scaffold the `src/modules/onboarding/` module with config, DTOs, and NestJS module registration.

## Key Insights
- Follow existing module patterns (AI, Auth, Subscription)
- Config as plain TypeScript object (not ConfigService) -- matches brainstorm decision
- DTOs use `class-validator` + `@ApiProperty` per code standards
- Module needs `TypeOrmModule.forFeature` for AiConversation + AiConversationMessage

## Requirements

### Functional
- `onboarding.config.ts` with maxTurns, sessionTtlDays, model, maxTokens, temperature
- 3 DTOs: start, chat, complete
- Module registered in AppModule

### Non-Functional
- Each file under 200 lines
- kebab-case file naming
- Swagger annotations on DTOs

## Architecture

```
src/modules/onboarding/
  onboarding.module.ts          # NestJS module (imports AI deps)
  onboarding.config.ts          # Static config object
  onboarding.controller.ts      # 3 @Public() endpoints (phase 03)
  onboarding.service.ts         # Business logic (phase 03)
  dto/
    start-onboarding.dto.ts     # { native_language, target_language }
    onboarding-chat.dto.ts      # { session_token, message }
    onboarding-complete.dto.ts  # { session_token }
    index.ts                    # Barrel export
```

## Related Code Files

### Files to Create
- `src/modules/onboarding/onboarding.module.ts`
- `src/modules/onboarding/onboarding.config.ts`
- `src/modules/onboarding/dto/start-onboarding.dto.ts`
- `src/modules/onboarding/dto/onboarding-chat.dto.ts`
- `src/modules/onboarding/dto/onboarding-complete.dto.ts`
- `src/modules/onboarding/dto/index.ts`

### Files to Modify
- `src/app.module.ts` (add OnboardingModule to imports)

## Implementation Steps

### Step 1: Create Config

File: `src/modules/onboarding/onboarding.config.ts`

```typescript
import { LLMModel } from '../ai/providers/llm-models.enum';

export const onboardingConfig = {
  maxTurns: 10,
  sessionTtlDays: 7,
  llmModel: LLMModel.GEMINI_2_5_FLASH,
  maxTokens: 1024,
  temperature: 0.7,
};
```

### Step 2: Create DTOs

**`dto/start-onboarding.dto.ts`**
```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class StartOnboardingDto {
  @ApiProperty({ example: 'vi', description: 'ISO 639-1 native language code' })
  @IsString()
  @Length(2, 5)
  nativeLanguage!: string;

  @ApiProperty({ example: 'en', description: 'ISO 639-1 target language code' })
  @IsString()
  @Length(2, 5)
  targetLanguage!: string;
}
```

**`dto/onboarding-chat.dto.ts`**
```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength } from 'class-validator';

export class OnboardingChatDto {
  @ApiProperty({ description: 'Session token from /onboarding/start' })
  @IsUUID()
  sessionToken!: string;

  @ApiProperty({ example: 'Hi! My name is Thanh', description: 'User message' })
  @IsString()
  @MaxLength(2000)
  message!: string;
}
```

**`dto/onboarding-complete.dto.ts`**
```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class OnboardingCompleteDto {
  @ApiProperty({ description: 'Session token from /onboarding/start' })
  @IsUUID()
  sessionToken!: string;
}
```

**`dto/index.ts`**
```typescript
export * from './start-onboarding.dto';
export * from './onboarding-chat.dto';
export * from './onboarding-complete.dto';
```

### Step 3: Create Module

File: `src/modules/onboarding/onboarding.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiConversation, AiConversationMessage } from '../../database/entities';
import { AiModule } from '../ai/ai.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiConversation, AiConversationMessage]),
    AiModule,
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
```

### Step 4: Register in AppModule

Add to `src/app.module.ts` imports array:

```typescript
import { OnboardingModule } from './modules/onboarding/onboarding.module';
// ...
imports: [
  // ... existing modules
  OnboardingModule,
],
```

## Todo List
- [ ] Create `onboarding.config.ts`
- [ ] Create 3 DTO files + barrel export
- [ ] Create `onboarding.module.ts`
- [ ] Add `OnboardingModule` to `app.module.ts`
- [ ] Run `npm run build` to confirm compilation (controller/service stubs needed)

## Success Criteria
- All files created following naming conventions
- DTOs have proper validation decorators
- Module imports TypeORM entities + AiModule
- `npm run build` passes (may need stub controller/service)

## Risk Assessment
- **Low:** Standard NestJS scaffolding, no logic yet
- **Low:** Circular dependency unlikely (onboarding imports AI, AI doesn't import onboarding)

## Security Considerations
- DTOs enforce input validation (MaxLength, IsUUID, Length)
- No auth required -- endpoints will be @Public()

## Next Steps
- Phase 03: Service & Controller implementation
