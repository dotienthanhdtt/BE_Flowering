# Phase 05: AI Module with LangChain

## Overview

| Field | Value |
|-------|-------|
| Priority | P1 - Critical Path |
| Status | pending |
| Effort | 6h |
| Dependencies | Phase 02, Phase 03 |

Implement AI module with LangChain integration: LLM provider abstraction, tiered routing (simple/complex), prompt loader service, learning agent service, Langfuse tracing, and AI controller with rate limiting.

## Key Insights

From research:
- Use `@langchain/openai` and `@langchain/anthropic` for LLM providers
- Tiered routing: GPT-4o-mini for simple tasks, GPT-4o for complex
- Langfuse `CallbackHandler` integrates seamlessly with LangChain
- Prompts stored as `.md` files with `{{variable}}` placeholders
- SSE streaming for chat responses

## Requirements

### Functional
- Chat with AI tutor (context-aware conversation)
- Grammar checking
- Exercise generation
- Pronunciation assessment (text comparison after Whisper transcription)
- Streaming responses for chat

### Non-Functional
- Chat response time <3s
- Grammar check <1s
- Rate limiting: 100 requests/hour for free tier
- All LLM calls traced in Langfuse

## Architecture

```
src/modules/ai/
├── ai.module.ts
├── ai.controller.ts
├── providers/
│   ├── llm-provider.interface.ts
│   ├── openai-llm.provider.ts
│   ├── anthropic-llm.provider.ts
│   └── tiered-llm.provider.ts
├── services/
│   ├── prompt-loader.service.ts
│   ├── langfuse.service.ts
│   ├── learning-agent.service.ts
│   └── whisper-transcription.service.ts
├── prompts/
│   ├── tutor-system-prompt.md
│   ├── grammar-check-prompt.md
│   ├── exercise-generator-prompt.md
│   └── pronunciation-assessment-prompt.md
├── guards/
│   └── rate-limit.guard.ts
└── dto/
    ├── chat-request.dto.ts
    ├── chat-response.dto.ts
    ├── grammar-check.dto.ts
    ├── generate-exercise.dto.ts
    └── pronunciation-assessment.dto.ts
```

## Related Code Files

### Files to Create
- `src/modules/ai/ai.module.ts`
- `src/modules/ai/ai.controller.ts`
- `src/modules/ai/providers/llm-provider.interface.ts`
- `src/modules/ai/providers/openai-llm.provider.ts`
- `src/modules/ai/providers/anthropic-llm.provider.ts`
- `src/modules/ai/providers/tiered-llm.provider.ts`
- `src/modules/ai/services/prompt-loader.service.ts`
- `src/modules/ai/services/langfuse.service.ts`
- `src/modules/ai/services/learning-agent.service.ts`
- `src/modules/ai/services/whisper-transcription.service.ts`
- `src/modules/ai/guards/rate-limit.guard.ts`
- `src/modules/ai/dto/chat-request.dto.ts`
- `src/modules/ai/dto/chat-response.dto.ts`
- `src/modules/ai/dto/grammar-check.dto.ts`
- `src/modules/ai/dto/generate-exercise.dto.ts`
- `src/modules/ai/dto/pronunciation-assessment.dto.ts`
- `src/modules/ai/prompts/tutor-system-prompt.md`
- `src/modules/ai/prompts/grammar-check-prompt.md`
- `src/modules/ai/prompts/exercise-generator-prompt.md`
- `src/modules/ai/prompts/pronunciation-assessment-prompt.md`

## Implementation Steps

### Step 1: Install AI Dependencies (10min)

```bash
npm install @langchain/openai @langchain/anthropic @langchain/core langchain
npm install langfuse-langchain
npm install @nestjs/throttler  # For rate limiting
npm install openai  # For Whisper API
```

### Step 2: Create LLM Provider Interface (20min)

```typescript
// src/modules/ai/providers/llm-provider.interface.ts
import { BaseMessage } from '@langchain/core/messages';

export interface LLMProvider {
  chat(messages: BaseMessage[], options?: LLMOptions): Promise<string>;
  stream(messages: BaseMessage[], options?: LLMOptions): AsyncIterable<string>;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}
```

### Step 3: Create OpenAI LLM Provider (30min)

```typescript
// src/modules/ai/providers/openai-llm.provider.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { BaseMessage } from '@langchain/core/messages';
import { LLMProvider, LLMOptions } from './llm-provider.interface';

@Injectable()
export class OpenAILLMProvider implements LLMProvider {
  private model: ChatOpenAI;

  constructor(
    private configService: ConfigService,
    private langfuseService: LangfuseService,
    modelName: string,
  ) {
    this.model = new ChatOpenAI({
      modelName,
      openAIApiKey: configService.get('OPENAI_API_KEY'),
      streaming: true,
      callbacks: [langfuseService.getHandler()],
    });
  }

  async chat(messages: BaseMessage[], options?: LLMOptions): Promise<string> {
    const response = await this.model.invoke(messages, {
      metadata: options?.metadata,
    });
    return response.content as string;
  }

  async *stream(messages: BaseMessage[], options?: LLMOptions): AsyncIterable<string> {
    const stream = await this.model.stream(messages, {
      metadata: options?.metadata,
    });

    for await (const chunk of stream) {
      yield chunk.content as string;
    }
  }
}
```

### Step 4: Create Tiered LLM Provider (40min)

```typescript
// src/modules/ai/providers/tiered-llm.provider.ts
@Injectable()
export class TieredLLMProvider {
  public readonly simple: LLMProvider;
  public readonly complex: LLMProvider;

  constructor(
    private configService: ConfigService,
    private langfuseService: LangfuseService,
  ) {
    const provider = configService.get('LLM_PROVIDER', 'openai');

    if (provider === 'openai') {
      this.simple = new OpenAILLMProvider(
        configService,
        langfuseService,
        configService.get('LLM_SIMPLE_MODEL', 'gpt-4o-mini'),
      );
      this.complex = new OpenAILLMProvider(
        configService,
        langfuseService,
        configService.get('LLM_COMPLEX_MODEL', 'gpt-4o'),
      );
    } else if (provider === 'anthropic') {
      this.simple = new AnthropicLLMProvider(
        configService,
        langfuseService,
        'claude-3-haiku-20240307',
      );
      this.complex = new AnthropicLLMProvider(
        configService,
        langfuseService,
        'claude-3-5-sonnet-20241022',
      );
    }
  }

  // Determine complexity based on task type
  getProviderForTask(taskType: 'chat' | 'grammar' | 'exercise' | 'pronunciation'): LLMProvider {
    const complexTasks = ['chat', 'exercise'];
    return complexTasks.includes(taskType) ? this.complex : this.simple;
  }
}
```

### Step 5: Create Langfuse Service (30min)

```typescript
// src/modules/ai/services/langfuse.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallbackHandler } from 'langfuse-langchain';

@Injectable()
export class LangfuseService implements OnModuleInit, OnModuleDestroy {
  private handler: CallbackHandler;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.handler = new CallbackHandler({
      secretKey: this.configService.get('LANGFUSE_SECRET_KEY'),
      publicKey: this.configService.get('LANGFUSE_PUBLIC_KEY'),
      baseUrl: this.configService.get('LANGFUSE_BASE_URL', 'https://cloud.langfuse.com'),
      flushAt: 1,
      flushInterval: 1000,
    });
  }

  async onModuleDestroy() {
    await this.handler.flushAsync();
  }

  getHandler(): CallbackHandler {
    return this.handler;
  }

  // Create handler with user context
  createUserHandler(userId: string, sessionId: string): CallbackHandler {
    return new CallbackHandler({
      secretKey: this.configService.get('LANGFUSE_SECRET_KEY'),
      publicKey: this.configService.get('LANGFUSE_PUBLIC_KEY'),
      baseUrl: this.configService.get('LANGFUSE_BASE_URL'),
      userId,
      sessionId,
    });
  }
}
```

### Step 6: Create Prompt Loader Service (30min)

```typescript
// src/modules/ai/services/prompt-loader.service.ts
import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class PromptLoaderService {
  private readonly promptsDir = join(__dirname, '../prompts');
  private cache = new Map<string, string>();

  loadPrompt(name: string, variables: Record<string, string> = {}): string {
    let template = this.cache.get(name);

    if (!template) {
      const filePath = join(this.promptsDir, `${name}.md`);
      template = readFileSync(filePath, 'utf-8');
      this.cache.set(name, template);
    }

    // Replace {{variable}} placeholders
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    return result;
  }

  // Clear cache (for hot reload in dev)
  clearCache(): void {
    this.cache.clear();
  }
}
```

### Step 7: Create Learning Agent Service (90min)

```typescript
// src/modules/ai/services/learning-agent.service.ts
import { Injectable } from '@nestjs/common';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { TieredLLMProvider } from '../providers/tiered-llm.provider';
import { PromptLoaderService } from './prompt-loader.service';
import { LangfuseService } from './langfuse.service';

@Injectable()
export class LearningAgentService {
  constructor(
    private llmProvider: TieredLLMProvider,
    private promptLoader: PromptLoaderService,
    private langfuseService: LangfuseService,
    @InjectRepository(AiConversation)
    private conversationRepo: Repository<AiConversation>,
    @InjectRepository(AiConversationMessage)
    private messageRepo: Repository<AiConversationMessage>,
  ) {}

  // Main tutoring chat
  async chat(
    userId: string,
    message: string,
    context: ConversationContext,
  ): Promise<ChatResponseDto> {
    const systemPrompt = this.promptLoader.loadPrompt('tutor-system-prompt', {
      targetLanguage: context.targetLanguage,
      nativeLanguage: context.nativeLanguage,
      proficiencyLevel: context.proficiencyLevel,
      lessonTopic: context.lessonTopic || 'General conversation',
    });

    // Get conversation history
    const history = await this.getConversationHistory(context.conversationId);

    const messages = [
      new SystemMessage(systemPrompt),
      ...history,
      new HumanMessage(message),
    ];

    const response = await this.llmProvider.complex.chat(messages, {
      metadata: { userId, feature: 'chat', conversationId: context.conversationId },
    });

    // Save messages to database
    await this.saveMessage(context.conversationId, 'user', message);
    await this.saveMessage(context.conversationId, 'assistant', response);

    return { message: response, conversationId: context.conversationId };
  }

  // Streaming chat
  async *streamChat(
    userId: string,
    message: string,
    context: ConversationContext,
  ): AsyncIterable<string> {
    const systemPrompt = this.promptLoader.loadPrompt('tutor-system-prompt', {
      targetLanguage: context.targetLanguage,
      nativeLanguage: context.nativeLanguage,
      proficiencyLevel: context.proficiencyLevel,
      lessonTopic: context.lessonTopic || 'General conversation',
    });

    const history = await this.getConversationHistory(context.conversationId);
    const messages = [
      new SystemMessage(systemPrompt),
      ...history,
      new HumanMessage(message),
    ];

    let fullResponse = '';
    for await (const chunk of this.llmProvider.complex.stream(messages)) {
      fullResponse += chunk;
      yield chunk;
    }

    await this.saveMessage(context.conversationId, 'user', message);
    await this.saveMessage(context.conversationId, 'assistant', fullResponse);
  }

  // Grammar checking (simple model)
  async checkGrammar(text: string, targetLanguage: string): Promise<GrammarResultDto> {
    const prompt = this.promptLoader.loadPrompt('grammar-check-prompt', {
      text,
      targetLanguage,
    });

    const response = await this.llmProvider.simple.chat([new HumanMessage(prompt)], {
      metadata: { feature: 'grammar-check' },
    });

    return this.parseGrammarResponse(response);
  }

  // Exercise generation (complex model)
  async generateExercise(params: GenerateExerciseDto): Promise<ExerciseDto> {
    const prompt = this.promptLoader.loadPrompt('exercise-generator-prompt', {
      exerciseType: params.type,
      targetLanguage: params.targetLanguage,
      proficiencyLevel: params.proficiencyLevel,
      topic: params.topic,
    });

    const response = await this.llmProvider.complex.chat([new HumanMessage(prompt)], {
      metadata: { feature: 'exercise-generation' },
    });

    return this.parseExerciseResponse(response);
  }

  // Pronunciation assessment (simple model)
  async assessPronunciation(
    transcribedText: string,
    expectedText: string,
    targetLanguage: string,
  ): Promise<PronunciationResultDto> {
    const prompt = this.promptLoader.loadPrompt('pronunciation-assessment-prompt', {
      transcribedText,
      expectedText,
      targetLanguage,
    });

    const response = await this.llmProvider.simple.chat([new HumanMessage(prompt)], {
      metadata: { feature: 'pronunciation-assessment' },
    });

    return this.parsePronunciationResponse(response);
  }

  private async getConversationHistory(conversationId: string): Promise<BaseMessage[]> {
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: 20, // Last 20 messages for context
    });

    return messages.map(m =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
    );
  }
}
```

### Step 8: Create Whisper Transcription Service (30min)

```typescript
// src/modules/ai/services/whisper-transcription.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class WhisperTranscriptionService {
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: configService.get('OPENAI_API_KEY'),
    });
  }

  async transcribe(audioBuffer: Buffer, language?: string): Promise<string> {
    const file = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' });

    const response = await this.openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language, // ISO 639-1 code (e.g., 'en', 'ja', 'vi')
    });

    return response.text;
  }
}
```

### Step 9: Create Rate Limit Guard (20min)

```typescript
// src/modules/ai/guards/rate-limit.guard.ts
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';

@Injectable()
export class AiRateLimitGuard extends ThrottlerGuard {
  protected async throwThrottlingException(): Promise<void> {
    throw new ThrottlerException('AI request rate limit exceeded. Upgrade to premium for higher limits.');
  }

  // Custom rate limit based on subscription tier
  protected async getLimit(context: ExecutionContext): Promise<number> {
    const user = context.switchToHttp().getRequest().user;
    const subscription = await this.subscriptionService.getUserSubscription(user.id);

    return subscription?.planType === 'premium' ? 1000 : 100; // per hour
  }
}
```

### Step 10: Create AI Controller (40min)

```typescript
// src/modules/ai/ai.controller.ts
@ApiTags('ai')
@Controller('ai')
@UseGuards(AiRateLimitGuard)
export class AiController {
  constructor(
    private learningAgent: LearningAgentService,
    private whisperService: WhisperTranscriptionService,
  ) {}

  @Post('chat')
  @ApiOperation({ summary: 'Chat with AI tutor' })
  async chat(
    @CurrentUser() user: User,
    @Body() dto: ChatRequestDto,
  ): Promise<ChatResponseDto> {
    return this.learningAgent.chat(user.id, dto.message, dto.context);
  }

  @Sse('chat/stream')
  @ApiOperation({ summary: 'Stream chat response (SSE)' })
  async streamChat(
    @CurrentUser() user: User,
    @Query() dto: ChatRequestDto,
  ): Promise<Observable<MessageEvent>> {
    const stream = this.learningAgent.streamChat(user.id, dto.message, dto.context);

    return from(this.toArray(stream)).pipe(
      map(chunk => ({ data: { content: chunk } })),
    );
  }

  @Post('grammar/check')
  @ApiOperation({ summary: 'Check text grammar' })
  async checkGrammar(@Body() dto: GrammarCheckDto): Promise<GrammarResultDto> {
    return this.learningAgent.checkGrammar(dto.text, dto.targetLanguage);
  }

  @Post('exercises/generate')
  @ApiOperation({ summary: 'Generate exercise' })
  async generateExercise(@Body() dto: GenerateExerciseDto): Promise<ExerciseDto> {
    return this.learningAgent.generateExercise(dto);
  }

  @Post('pronunciation/assess')
  @ApiOperation({ summary: 'Assess pronunciation from audio' })
  @UseInterceptors(FileInterceptor('audio'))
  async assessPronunciation(
    @UploadedFile() audio: Express.Multer.File,
    @Body() dto: PronunciationAssessmentDto,
  ): Promise<PronunciationResultDto> {
    const transcribedText = await this.whisperService.transcribe(
      audio.buffer,
      dto.targetLanguage,
    );

    return this.learningAgent.assessPronunciation(
      transcribedText,
      dto.expectedText,
      dto.targetLanguage,
    );
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Start new conversation' })
  async createConversation(
    @CurrentUser() user: User,
    @Body() dto: CreateConversationDto,
  ): Promise<ConversationDto> {
    return this.learningAgent.createConversation(user.id, dto);
  }

  @Get('conversations/:id/history')
  @ApiOperation({ summary: 'Get conversation history' })
  async getConversationHistory(
    @CurrentUser() user: User,
    @Param('id') conversationId: string,
  ): Promise<ConversationMessageDto[]> {
    return this.learningAgent.getConversationHistory(conversationId);
  }
}
```

### Step 11: Create Prompt Files (30min)

```markdown
<!-- src/modules/ai/prompts/tutor-system-prompt.md -->
You are a friendly, patient language tutor helping users learn {{targetLanguage}}.

## Your Role
- Engage in natural conversation at the {{proficiencyLevel}} level
- Correct mistakes gently with explanations
- Provide vocabulary and grammar tips contextually
- Encourage and motivate the learner

## Guidelines
- Use {{targetLanguage}} primarily, with {{nativeLanguage}} explanations when needed
- Keep responses concise (2-4 sentences for beginners, more for advanced)
- Ask follow-up questions to keep conversation flowing
- Celebrate progress and correct errors constructively

## User Context
- Native language: {{nativeLanguage}}
- Learning: {{targetLanguage}}
- Level: {{proficiencyLevel}}
- Current topic: {{lessonTopic}}
```

```markdown
<!-- src/modules/ai/prompts/grammar-check-prompt.md -->
Check the following {{targetLanguage}} text for grammar errors.

Text: {{text}}

Respond in JSON format:
{
  "isCorrect": boolean,
  "errors": [
    {
      "original": "incorrect phrase",
      "correction": "correct phrase",
      "explanation": "brief explanation"
    }
  ],
  "correctedText": "full corrected text"
}
```

## Todo List

- [ ] Install LangChain and related dependencies
- [ ] Create LLMProvider interface
- [ ] Implement OpenAILLMProvider
- [ ] Implement AnthropicLLMProvider
- [ ] Create TieredLLMProvider with model routing
- [ ] Create LangfuseService for tracing
- [ ] Create PromptLoaderService
- [ ] Create tutor-system-prompt.md
- [ ] Create grammar-check-prompt.md
- [ ] Create exercise-generator-prompt.md
- [ ] Create pronunciation-assessment-prompt.md
- [ ] Implement LearningAgentService chat method
- [ ] Implement LearningAgentService streamChat method
- [ ] Implement LearningAgentService checkGrammar method
- [ ] Implement LearningAgentService generateExercise method
- [ ] Implement LearningAgentService assessPronunciation method
- [ ] Create WhisperTranscriptionService
- [ ] Create AiRateLimitGuard
- [ ] Create AiController with all endpoints
- [ ] Create all DTOs
- [ ] Configure ThrottlerModule
- [ ] Write unit tests for LearningAgentService
- [ ] Test Langfuse traces appear correctly

## Success Criteria

- [x] POST /ai/chat returns AI response within 3s
- [x] SSE /ai/chat/stream streams response chunks
- [x] POST /ai/grammar/check returns corrections within 1s
- [x] POST /ai/exercises/generate creates valid exercises
- [x] POST /ai/pronunciation/assess transcribes and scores
- [x] Rate limiting enforced per user tier
- [x] All LLM calls traced in Langfuse dashboard
- [x] Prompts load from .md files correctly

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| LLM API rate limits | Medium | High | Implement retry with backoff, queue |
| High API costs | High | Medium | Tiered model routing, monitoring |
| Langfuse connectivity | Low | Low | Graceful degradation if unavailable |
| Prompt injection | Medium | Medium | Input sanitization, prompt hardening |

## Security Considerations

- Rate limiting prevents abuse
- User input sanitized before prompt injection
- API keys in environment variables only
- Audio files validated (type, size) before processing
- Langfuse traces exclude sensitive PII
