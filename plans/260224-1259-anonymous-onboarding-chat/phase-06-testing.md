# Phase 06: Testing

## Context Links
- [Parent Plan](./plan.md)
- [Phase 03 (service to test)](./phase-03-onboarding-service-and-controller.md)
- [Phase 05 (auth linking to test)](./phase-05-auth-linking.md)
- [Existing Test Pattern](../../src/modules/auth/auth.service.spec.ts)
- [Code Standards - Testing](../../docs/code-standards.md)

## Overview
- **Priority:** P2
- **Status:** completed
- **Effort:** 1h
- **Description:** Unit tests for OnboardingService and AuthService linking. E2E tests for the 3 onboarding endpoints.

## Key Insights
- Follow existing test pattern in `auth.service.spec.ts`
- Use `@nestjs/testing` TestingModule with mock repositories
- Mock `UnifiedLLMService`, `PromptLoaderService`, `LangfuseService`
- E2E tests use `supertest` with real app instance

## Requirements

### Functional
- Unit tests for: startSession, chat, complete, session validation, turn limits, expiry
- Unit tests for: auth linking (register + login with sessionToken)
- E2E tests for: full onboarding flow (start -> chat x N -> complete)

### Non-Functional
- Tests must pass with `npm test`
- No real LLM calls in unit tests (mock UnifiedLLMService)

## Related Code Files

### Files to Create
- `src/modules/onboarding/onboarding.service.spec.ts`
- `src/modules/onboarding/onboarding.controller.spec.ts`

### Files to Modify
- `src/modules/auth/auth.service.spec.ts` (add linking tests)

## Implementation Steps

### Step 1: OnboardingService Unit Tests

File: `src/modules/onboarding/onboarding.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { AiConversation, AiConversationMessage } from '../../database/entities';
import { UnifiedLLMService } from '../ai/services/unified-llm.service';
import { PromptLoaderService } from '../ai/services/prompt-loader.service';
import { LangfuseService } from '../ai/services/langfuse-tracing.service';
import { AiConversationType } from '../../database/entities/ai-conversation.entity';

const mockConversationRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  increment: jest.fn(),
});

const mockMessageRepo = () => ({
  save: jest.fn(),
  find: jest.fn(),
});

const mockLLMService = () => ({
  chat: jest.fn(),
});

const mockPromptLoader = () => ({
  loadPrompt: jest.fn().mockReturnValue('system prompt'),
});

const mockLangfuse = () => ({
  createUserHandler: jest.fn().mockReturnValue({}),
});

describe('OnboardingService', () => {
  let service: OnboardingService;
  let conversationRepo, messageRepo, llmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: getRepositoryToken(AiConversation), useFactory: mockConversationRepo },
        { provide: getRepositoryToken(AiConversationMessage), useFactory: mockMessageRepo },
        { provide: UnifiedLLMService, useFactory: mockLLMService },
        { provide: PromptLoaderService, useFactory: mockPromptLoader },
        { provide: LangfuseService, useFactory: mockLangfuse },
      ],
    }).compile();

    service = module.get(OnboardingService);
    conversationRepo = module.get(getRepositoryToken(AiConversation));
    messageRepo = module.get(getRepositoryToken(AiConversationMessage));
    llmService = module.get(UnifiedLLMService);
  });

  // Test cases described below
});
```

**Test cases to implement:**

1. `startSession` - creates conversation with correct fields, returns token + id
2. `chat` - valid session returns AI reply with turn info
3. `chat` - throws NotFoundException for invalid session token
4. `chat` - throws BadRequestException when session expired
5. `chat` - throws BadRequestException when max turns exceeded
6. `chat` - increments messageCount by 2
7. `complete` - extracts JSON from conversation transcript
8. `complete` - returns raw response when JSON parsing fails

### Step 2: OnboardingController Unit Tests

File: `src/modules/onboarding/onboarding.controller.spec.ts`

Test that controller delegates to service correctly:

1. `start` - calls service.startSession with DTO
2. `chat` - calls service.chat with DTO
3. `complete` - calls service.complete with DTO

### Step 3: Auth Linking Tests

Add to `src/modules/auth/auth.service.spec.ts`:

1. `register with sessionToken` - calls linkOnboardingSession after user creation
2. `register without sessionToken` - does not call linkOnboardingSession
3. `linkOnboardingSession` - updates conversation with userId, clears sessionToken
4. `linkOnboardingSession` - logs warning when no matching session found
5. `linkOnboardingSession` - logs warning on error, does not throw

### Step 4: E2E Test (optional for MVP)

File: `test/onboarding.e2e-spec.ts`

```typescript
describe('Onboarding (e2e)', () => {
  it('should complete full onboarding flow', async () => {
    // 1. POST /onboarding/start -> get sessionToken
    // 2. POST /onboarding/chat x 3 -> verify turn numbers
    // 3. POST /onboarding/complete -> verify JSON extraction
  });

  it('should reject expired session', async () => { ... });
  it('should reject after max turns', async () => { ... });
});
```

## Todo List
- [x] Create `onboarding.service.spec.ts` with 8+ test cases
- [x] Create `onboarding.controller.spec.ts`
- [x] Add auth linking tests to `auth.service.spec.ts`
- [x] Run `npm test` -- all tests pass (48/48)
- [ ] Run `npm run test:cov` -- check coverage (optional, skipped for MVP)
- [ ] (Optional) Create e2e test for full flow (skipped for MVP)

## Success Criteria
- All unit tests pass
- Coverage for OnboardingService > 80%
- Auth linking tests pass
- No existing tests broken

## Risk Assessment
- **Low:** Mocking TypeORM repos is well-established pattern
- **Low:** Existing auth tests might need fixture updates for new constructor param (AiConversation repo)

## Security Considerations
- Tests should verify session validation (expired, invalid token)
- Tests should verify turn limit enforcement

## Next Steps
- Deploy and manual QA
- Iterative prompt tuning based on real conversations
