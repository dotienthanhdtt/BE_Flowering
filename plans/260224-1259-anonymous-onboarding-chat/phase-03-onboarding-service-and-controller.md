# Phase 03: Onboarding Service & Controller

## Context Links
- [Parent Plan](./plan.md)
- [Phase 01 (entity changes)](./phase-01-database-migration.md)
- [Phase 02 (module/DTOs)](./phase-02-onboarding-module-setup.md)
- [Session & AI Research](./reports/researcher-02-anonymous-session-ai-patterns.md)
- [LearningAgentService](../../src/modules/ai/services/learning-agent.service.ts)
- [UnifiedLLMService](../../src/modules/ai/services/unified-llm.service.ts)
- [LangfuseService](../../src/modules/ai/services/langfuse-tracing.service.ts)
- [PromptLoaderService](../../src/modules/ai/services/prompt-loader.service.ts)

## Overview
- **Priority:** P1
- **Status:** complete
- **Effort:** 2h
- **Description:** Core business logic for anonymous onboarding chat. Service manages session lifecycle (create, chat, complete). Controller exposes 3 @Public() endpoints. Uses UnifiedLLMService directly (not LearningAgentService) for clean separation.

## Key Insights
- Use `UnifiedLLMService` + `PromptLoaderService` directly (simpler than wrapping LearningAgentService)
- Session token = UUID v4 generated server-side via `crypto.randomUUID()`
- Turn tracking: `messageCount / 2` = current turn (user+assistant per turn)
- Extraction uses separate prompt with conversation history -> JSON output
- Langfuse tracing: `sessionId = sessionToken`, `userId = 'anonymous'`

## Requirements

### Functional
- **POST /onboarding/start**: Create conversation with session_token, return token + conversation_id
- **POST /onboarding/chat**: Validate session, check turn limit, call LLM, save messages, return reply + turn info
- **POST /onboarding/complete**: Read full conversation, call extraction prompt, return structured JSON

### Non-Functional
- Each file under 200 lines
- Proper error handling with NestJS exceptions
- Langfuse tracing on every LLM call
- No streaming (simple request-response)

## Architecture

```
Client -> OnboardingController -> OnboardingService -> UnifiedLLMService
                                       |                    |
                                       |              PromptLoaderService
                                       |
                                  TypeORM Repos
                              (AiConversation, AiConversationMessage)
```

### Flow: Start Session
```
1. Generate UUID session_token
2. Find language by code (or use code directly)
3. Create AiConversation { sessionToken, type: 'anonymous', expiresAt: now+7d }
4. Return { session_token, conversation_id }
```

### Flow: Chat
```
1. Find conversation by session_token
2. Validate: not expired, turn limit not reached
3. Load conversation history from DB
4. Build messages: [SystemPrompt, ...history, UserMessage]
5. Call UnifiedLLMService.chat()
6. Save user + assistant messages to DB
7. Increment messageCount by 2
8. Return { reply, turn_number, is_last_turn }
```

### Flow: Complete
```
1. Find conversation by session_token
2. Load all messages
3. Build extraction prompt with conversation transcript
4. Call UnifiedLLMService.chat() with extraction prompt
5. Parse JSON response
6. Return structured onboarding data
```

## Related Code Files

### Files to Create
- `src/modules/onboarding/onboarding.service.ts`
- `src/modules/onboarding/onboarding.controller.ts`

### Files Referenced (read-only)
- `src/modules/ai/services/unified-llm.service.ts`
- `src/modules/ai/services/prompt-loader.service.ts`
- `src/modules/ai/services/langfuse-tracing.service.ts`
- `src/database/entities/ai-conversation.entity.ts`
- `src/database/entities/ai-conversation-message.entity.ts`

## Implementation Steps

### Step 1: Create OnboardingService

File: `src/modules/onboarding/onboarding.service.ts`

```typescript
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { AiConversation, AiConversationMessage, MessageRole } from '../../database/entities';
import { AiConversationType } from '../../database/entities/ai-conversation.entity';
import { UnifiedLLMService } from '../ai/services/unified-llm.service';
import { PromptLoaderService } from '../ai/services/prompt-loader.service';
import { LangfuseService } from '../ai/services/langfuse-tracing.service';
import { onboardingConfig } from './onboarding.config';
import { StartOnboardingDto, OnboardingChatDto, OnboardingCompleteDto } from './dto';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectRepository(AiConversation)
    private conversationRepo: Repository<AiConversation>,
    @InjectRepository(AiConversationMessage)
    private messageRepo: Repository<AiConversationMessage>,
    private llmService: UnifiedLLMService,
    private promptLoader: PromptLoaderService,
    private langfuseService: LangfuseService,
  ) {}

  async startSession(dto: StartOnboardingDto) {
    const sessionToken = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + onboardingConfig.sessionTtlDays);

    const conversation = this.conversationRepo.create({
      sessionToken,
      type: AiConversationType.ANONYMOUS,
      expiresAt,
      title: 'Onboarding Chat',
      metadata: {
        nativeLanguage: dto.nativeLanguage,
        targetLanguage: dto.targetLanguage,
      },
    });
    const saved = await this.conversationRepo.save(conversation);

    return { sessionToken, conversationId: saved.id };
  }

  async chat(dto: OnboardingChatDto) {
    const conversation = await this.findValidSession(dto.sessionToken);
    const currentTurn = Math.floor(conversation.messageCount / 2) + 1;

    if (currentTurn > onboardingConfig.maxTurns) {
      throw new BadRequestException('Maximum turns reached. Call /onboarding/complete.');
    }

    const { nativeLanguage, targetLanguage } = conversation.metadata as Record<string, string>;
    const isLastTurn = currentTurn >= onboardingConfig.maxTurns;

    // Build prompt
    const systemPrompt = this.promptLoader.loadPrompt('onboarding-chat-prompt', {
      nativeLanguage,
      targetLanguage,
      currentTurn: String(currentTurn),
      maxTurns: String(onboardingConfig.maxTurns),
      isLastTurn: String(isLastTurn),
    });

    // Load history
    const history = await this.getHistory(conversation.id);
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...history,
      new HumanMessage(dto.message),
    ];

    // Call LLM with Langfuse tracing
    const handler = this.langfuseService.createUserHandler(
      'anonymous',
      dto.sessionToken,
    );
    const reply = await this.llmService.chat(messages, {
      model: onboardingConfig.llmModel,
      temperature: onboardingConfig.temperature,
      maxTokens: onboardingConfig.maxTokens,
      metadata: {
        feature: 'onboarding',
        conversationId: conversation.id,
        turn: currentTurn,
        callbacks: [handler],
      },
    });

    // Save messages
    await this.saveMessage(conversation.id, MessageRole.USER, dto.message);
    await this.saveMessage(conversation.id, MessageRole.ASSISTANT, reply);
    await this.conversationRepo.increment({ id: conversation.id }, 'messageCount', 2);

    return { reply, turnNumber: currentTurn, isLastTurn };
  }

  async complete(dto: OnboardingCompleteDto) {
    const conversation = await this.findValidSession(dto.sessionToken);
    const messages = await this.messageRepo.find({
      where: { conversationId: conversation.id },
      order: { createdAt: 'ASC' },
    });

    // Build transcript for extraction
    const transcript = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    const extractionPrompt = this.promptLoader.loadPrompt(
      'onboarding-extraction-prompt',
      { transcript },
    );

    const handler = this.langfuseService.createUserHandler(
      'anonymous',
      dto.sessionToken,
    );
    const response = await this.llmService.chat(
      [new HumanMessage(extractionPrompt)],
      {
        model: onboardingConfig.llmModel,
        temperature: 0.1, // Low temp for extraction accuracy
        maxTokens: 512,
        metadata: {
          feature: 'onboarding-extraction',
          conversationId: conversation.id,
          callbacks: [handler],
        },
      },
    );

    return this.parseExtraction(response);
  }

  // --- Private helpers ---

  private async findValidSession(sessionToken: string): Promise<AiConversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { sessionToken, type: AiConversationType.ANONYMOUS },
    });
    if (!conversation) {
      throw new NotFoundException('Session not found');
    }
    if (conversation.expiresAt && conversation.expiresAt < new Date()) {
      throw new BadRequestException('Session expired');
    }
    return conversation;
  }

  private async getHistory(conversationId: string): Promise<BaseMessage[]> {
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: 20,
    });
    return messages.map((m) =>
      m.role === MessageRole.USER
        ? new HumanMessage(m.content)
        : new AIMessage(m.content),
    );
  }

  private async saveMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
  ): Promise<void> {
    await this.messageRepo.save({ conversationId, role, content });
  }

  private parseExtraction(response: string): Record<string, unknown> {
    try {
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
      return JSON.parse(jsonStr);
    } catch {
      this.logger.warn('Failed to parse extraction JSON', { response });
      return { raw: response };
    }
  }
}
```

**Note:** Service is ~140 lines. If it grows, extract `findValidSession` + history helpers to a separate `onboarding-session.service.ts`.

### Step 2: Create OnboardingController

File: `src/modules/onboarding/onboarding.controller.ts`

```typescript
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public-route.decorator';
import { OnboardingService } from './onboarding.service';
import {
  StartOnboardingDto,
  OnboardingChatDto,
  OnboardingCompleteDto,
} from './dto';

@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Public()
  @Post('start')
  @ApiOperation({ summary: 'Start anonymous onboarding chat session' })
  @ApiResponse({ status: 201, description: 'Session created' })
  async start(@Body() dto: StartOnboardingDto) {
    return this.onboardingService.startSession(dto);
  }

  @Public()
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send message in onboarding chat' })
  @ApiResponse({ status: 200, description: 'AI reply' })
  @ApiResponse({ status: 400, description: 'Max turns reached or session expired' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async chat(@Body() dto: OnboardingChatDto) {
    return this.onboardingService.chat(dto);
  }

  @Public()
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Extract structured onboarding data from conversation' })
  @ApiResponse({ status: 200, description: 'Extracted onboarding profile' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async complete(@Body() dto: OnboardingCompleteDto) {
    return this.onboardingService.complete(dto);
  }
}
```

## Todo List
- [ ] Create `onboarding.service.ts` with startSession, chat, complete methods
- [ ] Create `onboarding.controller.ts` with 3 @Public() endpoints
- [ ] Verify Langfuse handler passed correctly through LLMOptions metadata
- [ ] Test locally: POST /onboarding/start -> POST /onboarding/chat -> POST /onboarding/complete
- [ ] Run `npm run build`

## Success Criteria
- All 3 endpoints return correct response format `{ code: 1, message, data }`
- Session token validated on every chat/complete request
- Turn limit enforced (returns 400 after maxTurns)
- Expired sessions rejected
- Messages persisted in `ai_conversation_messages`
- `messageCount` incremented correctly
- Langfuse traces visible with `sessionId = session_token`

## Risk Assessment
- **Medium:** Langfuse callback handler may not propagate through `metadata.callbacks` in UnifiedLLMService. Verify the LLM provider passes callbacks to LangChain invoke. May need to adjust `LLMOptions` interface to include `callbacks` field.
- **Low:** JSON extraction may fail on poorly formatted LLM output. Fallback returns raw response.
- **Low:** Concurrent requests on same session could cause race condition on messageCount. Acceptable for MVP.

## Security Considerations
- Session tokens are UUIDv4 (128-bit random) -- not guessable
- Input validation via DTOs (MaxLength 2000 on message, IsUUID on token)
- Existing IP-based rate limiting from ThrottlerModule applies
- No user data exposed (anonymous sessions)

## Next Steps
- Phase 04: Create AI prompts for onboarding
- Verify Langfuse callback integration works end-to-end
