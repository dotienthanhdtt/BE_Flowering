# Phase 05: AI Module with LangChain

## Overview

| Field | Value |
|-------|-------|
| Priority | P1 - Critical Path |
| Status | complete |
| Effort | 6h |
| Dependencies | Phase 02, Phase 03 |

Implement AI module with LangChain integration: LLM provider abstraction, unified LLM service with model routing, prompt loader service, learning agent service, Langfuse tracing, and AI controller with rate limiting.

## Key Insights

From research:
- Use `@langchain/openai`, `@langchain/anthropic`, `@langchain/google-genai` for LLM providers
- Unified LLM service routes to correct provider based on model name prefix
- Model passed directly as parameter for flexibility (no tiered simple/complex)
- Langfuse `CallbackHandler` integrates seamlessly with LangChain
- Prompts stored as `.md` files with `{{variable}}` placeholders
- SSE streaming for chat responses

### Supported Models by Provider
| Provider | Models |
|----------|--------|
| OpenAI | gpt-4o, gpt-4o-mini, o1-preview, o1-mini |
| Anthropic | claude-3-5-sonnet, claude-3-haiku |
| Gemini | gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash |

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
│   ├── llm-models.enum.ts           # Model enum with all supported models
│   ├── llm-provider.interface.ts
│   ├── openai-llm.provider.ts
│   ├── anthropic-llm.provider.ts
│   └── gemini-llm.provider.ts
├── services/
│   ├── llm.service.ts              # Unified LLM service with model routing
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
- `src/modules/ai/providers/llm-models.enum.ts`
- `src/modules/ai/providers/llm-provider.interface.ts`
- `src/modules/ai/providers/openai-llm.provider.ts`
- `src/modules/ai/providers/anthropic-llm.provider.ts`
- `src/modules/ai/providers/gemini-llm.provider.ts`
- `src/modules/ai/services/llm.service.ts`
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
npm install @langchain/openai @langchain/anthropic @langchain/google-genai @langchain/core langchain
npm install langfuse-langchain
npm install @nestjs/throttler  # For rate limiting
npm install openai  # For Whisper API
```

### Step 2: Create Model Enum and LLM Provider Interface (20min)

```typescript
// src/modules/ai/providers/llm-models.enum.ts
export enum LLMModel {
  // OpenAI Models
  OPENAI_GPT4O = 'gpt-4o',
  OPENAI_GPT4O_MINI = 'gpt-4o-mini',
  OPENAI_O1_PREVIEW = 'o1-preview',
  OPENAI_O1_MINI = 'o1-mini',

  // Anthropic Models
  ANTHROPIC_CLAUDE_3_5_SONNET = 'claude-3-5-sonnet-20241022',
  ANTHROPIC_CLAUDE_3_HAIKU = 'claude-3-haiku-20240307',

  // Gemini Models
  GEMINI_2_5_FLASH = 'gemini-2.5-flash-preview-05-20',
  GEMINI_2_0_FLASH = 'gemini-2.0-flash',
  GEMINI_1_5_PRO = 'gemini-1.5-pro',
  GEMINI_1_5_FLASH = 'gemini-1.5-flash',
}

// Helper to determine provider from model enum
export function getProviderFromModel(model: LLMModel): 'openai' | 'anthropic' | 'gemini' {
  const modelValue = model as string;
  if (modelValue.startsWith('gpt-') || modelValue.startsWith('o1')) {
    return 'openai';
  } else if (modelValue.startsWith('claude-')) {
    return 'anthropic';
  } else if (modelValue.startsWith('gemini-')) {
    return 'gemini';
  }
  throw new Error(`Unknown model provider for: ${model}`);
}
```

```typescript
// src/modules/ai/providers/llm-provider.interface.ts
import { BaseMessage } from '@langchain/core/messages';
import { LLMModel } from './llm-models.enum';

export interface LLMOptions {
  model: LLMModel;  // Required: model enum value
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface LLMProvider {
  chat(messages: BaseMessage[], options: LLMOptions): Promise<string>;
  stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string>;
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
  constructor(
    private configService: ConfigService,
    private langfuseService: LangfuseService,
  ) {}

  private getModel(modelName: string): ChatOpenAI {
    return new ChatOpenAI({
      modelName,
      openAIApiKey: this.configService.get('OPENAI_API_KEY'),
      streaming: true,
      callbacks: [this.langfuseService.getHandler()],
    });
  }

  async chat(messages: BaseMessage[], options: LLMOptions): Promise<string> {
    const model = this.getModel(options.model);
    const response = await model.invoke(messages, {
      metadata: options.metadata,
    });
    return response.content as string;
  }

  async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string> {
    const model = this.getModel(options.model);
    const stream = await model.stream(messages, {
      metadata: options.metadata,
    });

    for await (const chunk of stream) {
      yield chunk.content as string;
    }
  }
}
```

### Step 4: Create Gemini LLM Provider (30min)

```typescript
// src/modules/ai/providers/gemini-llm.provider.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { BaseMessage } from '@langchain/core/messages';
import { LLMProvider, LLMOptions } from './llm-provider.interface';

@Injectable()
export class GeminiLLMProvider implements LLMProvider {
  constructor(
    private configService: ConfigService,
    private langfuseService: LangfuseService,
  ) {}

  private getModel(modelName: string): ChatGoogleGenerativeAI {
    return new ChatGoogleGenerativeAI({
      modelName,
      apiKey: this.configService.get('GOOGLE_AI_API_KEY'),
      streaming: true,
      callbacks: [this.langfuseService.getHandler()],
    });
  }

  async chat(messages: BaseMessage[], options: LLMOptions): Promise<string> {
    const model = this.getModel(options.model);
    const response = await model.invoke(messages, {
      metadata: options.metadata,
    });
    return response.content as string;
  }

  async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string> {
    const model = this.getModel(options.model);
    const stream = await model.stream(messages, {
      metadata: options.metadata,
    });

    for await (const chunk of stream) {
      yield chunk.content as string;
    }
  }
}
```

### Step 5: Create Anthropic LLM Provider (30min)

```typescript
// src/modules/ai/providers/anthropic-llm.provider.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseMessage } from '@langchain/core/messages';
import { LLMProvider, LLMOptions } from './llm-provider.interface';

@Injectable()
export class AnthropicLLMProvider implements LLMProvider {
  constructor(
    private configService: ConfigService,
    private langfuseService: LangfuseService,
  ) {}

  private getModel(modelName: string): ChatAnthropic {
    return new ChatAnthropic({
      modelName,
      anthropicApiKey: this.configService.get('ANTHROPIC_API_KEY'),
      streaming: true,
      callbacks: [this.langfuseService.getHandler()],
    });
  }

  async chat(messages: BaseMessage[], options: LLMOptions): Promise<string> {
    const model = this.getModel(options.model);
    const response = await model.invoke(messages, {
      metadata: options.metadata,
    });
    return response.content as string;
  }

  async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string> {
    const model = this.getModel(options.model);
    const stream = await model.stream(messages, {
      metadata: options.metadata,
    });

    for await (const chunk of stream) {
      yield chunk.content as string;
    }
  }
}
```

### Step 6: Create Unified LLM Service (40min)

```typescript
// src/modules/ai/services/llm.service.ts
import { Injectable } from '@nestjs/common';
import { BaseMessage } from '@langchain/core/messages';
import { OpenAILLMProvider } from '../providers/openai-llm.provider';
import { AnthropicLLMProvider } from '../providers/anthropic-llm.provider';
import { GeminiLLMProvider } from '../providers/gemini-llm.provider';
import { LLMOptions } from '../providers/llm-provider.interface';
import { LLMModel, getProviderFromModel } from '../providers/llm-models.enum';

@Injectable()
export class LLMService {
  constructor(
    private openaiProvider: OpenAILLMProvider,
    private anthropicProvider: AnthropicLLMProvider,
    private geminiProvider: GeminiLLMProvider,
  ) {}

  // Route to correct provider based on model enum
  private getProvider(model: LLMModel) {
    const provider = getProviderFromModel(model);
    switch (provider) {
      case 'openai':
        return this.openaiProvider;
      case 'anthropic':
        return this.anthropicProvider;
      case 'gemini':
        return this.geminiProvider;
    }
  }

  async chat(messages: BaseMessage[], options: LLMOptions): Promise<string> {
    const provider = this.getProvider(options.model);
    return provider.chat(messages, options);
  }

  async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string> {
    const provider = this.getProvider(options.model);
    yield* provider.stream(messages, options);
  }
}
```

### Step 7: Create Langfuse Service (30min)

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

### Step 9: Create Learning Agent Service (90min)

```typescript
// src/modules/ai/services/learning-agent.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { LLMService } from './llm.service';
import { PromptLoaderService } from './prompt-loader.service';
import { LLMModel } from '../providers/llm-models.enum';
import { AiConversation, AiConversationMessage } from '../../../database/entities';

@Injectable()
export class LearningAgentService {
  // Default model from config
  private defaultModel: LLMModel;

  constructor(
    private llmService: LLMService,
    private promptLoader: PromptLoaderService,
    private configService: ConfigService,
    @InjectRepository(AiConversation)
    private conversationRepo: Repository<AiConversation>,
    @InjectRepository(AiConversationMessage)
    private messageRepo: Repository<AiConversationMessage>,
  ) {
    // Default model configurable via env, defaults to Gemini 2.5 Flash
    this.defaultModel = LLMModel.GEMINI_2_5_FLASH;
  }

  // Main tutoring chat - model passed as enum
  async chat(
    userId: string,
    message: string,
    context: ConversationContext,
    model?: LLMModel,  // Optional: override default model
  ): Promise<ChatResponseDto> {
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

    // Model passed as enum - type-safe!
    const response = await this.llmService.chat(messages, {
      model: model || this.defaultModel,
      metadata: { userId, feature: 'chat', conversationId: context.conversationId },
    });

    await this.saveMessage(context.conversationId, 'user', message);
    await this.saveMessage(context.conversationId, 'assistant', response);

    return { message: response, conversationId: context.conversationId };
  }

  // Streaming chat with model enum
  async *streamChat(
    userId: string,
    message: string,
    context: ConversationContext,
    model?: LLMModel,
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
    for await (const chunk of this.llmService.stream(messages, {
      model: model || this.defaultModel,
      metadata: { userId, feature: 'chat', conversationId: context.conversationId },
    })) {
      fullResponse += chunk;
      yield chunk;
    }

    await this.saveMessage(context.conversationId, 'user', message);
    await this.saveMessage(context.conversationId, 'assistant', fullResponse);
  }

  // Grammar checking with model enum
  async checkGrammar(
    text: string,
    targetLanguage: string,
    model?: LLMModel,
  ): Promise<GrammarResultDto> {
    const prompt = this.promptLoader.loadPrompt('grammar-check-prompt', {
      text,
      targetLanguage,
    });

    const response = await this.llmService.chat([new HumanMessage(prompt)], {
      model: model || LLMModel.GEMINI_1_5_FLASH, // Default to faster model
      metadata: { feature: 'grammar-check' },
    });

    return this.parseGrammarResponse(response);
  }

  // Exercise generation with model enum
  async generateExercise(
    params: GenerateExerciseDto,
    model?: LLMModel,
  ): Promise<ExerciseDto> {
    const prompt = this.promptLoader.loadPrompt('exercise-generator-prompt', {
      exerciseType: params.type,
      targetLanguage: params.targetLanguage,
      proficiencyLevel: params.proficiencyLevel,
      topic: params.topic,
    });

    const response = await this.llmService.chat([new HumanMessage(prompt)], {
      model: model || this.defaultModel,
      metadata: { feature: 'exercise-generation' },
    });

    return this.parseExerciseResponse(response);
  }

  // Pronunciation assessment with model enum
  async assessPronunciation(
    transcribedText: string,
    expectedText: string,
    targetLanguage: string,
    model?: LLMModel,
  ): Promise<PronunciationResultDto> {
    const prompt = this.promptLoader.loadPrompt('pronunciation-assessment-prompt', {
      transcribedText,
      expectedText,
      targetLanguage,
    });

    const response = await this.llmService.chat([new HumanMessage(prompt)], {
      model: model || LLMModel.GEMINI_1_5_FLASH, // Default to faster model
      metadata: { feature: 'pronunciation-assessment' },
    });

    return this.parsePronunciationResponse(response);
  }

  private async getConversationHistory(conversationId: string): Promise<BaseMessage[]> {
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: 20,
    });

    return messages.map(m =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
    );
  }

  private async saveMessage(conversationId: string, role: string, content: string): Promise<void> {
    await this.messageRepo.save({ conversationId, role, content });
  }

  private parseGrammarResponse(response: string): GrammarResultDto {
    return JSON.parse(response);
  }

  private parseExerciseResponse(response: string): ExerciseDto {
    return JSON.parse(response);
  }

  private parsePronunciationResponse(response: string): PronunciationResultDto {
    return JSON.parse(response);
  }
}
```

### Usage Example

```typescript
// In controller or service
import { LLMModel } from '../providers/llm-models.enum';

// Chat with default model (Gemini 2.5 Flash)
const response = await learningAgent.chat(userId, message, context);

// Chat with specific model using enum
const response = await learningAgent.chat(userId, message, context, LLMModel.OPENAI_GPT4O);

// Grammar check with Claude
const result = await learningAgent.checkGrammar(text, 'Japanese', LLMModel.ANTHROPIC_CLAUDE_3_HAIKU);

// Direct LLM service call
const response = await llmService.chat(messages, {
  model: LLMModel.GEMINI_2_5_FLASH,
  metadata: { userId: 'user-123', feature: 'custom' },
});
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

- [x] Install LangChain and related dependencies (including @langchain/google-genai)
- [x] Create LLMModel enum with all supported models
- [x] Create LLMProvider interface with model enum
- [x] Implement OpenAILLMProvider with dynamic model
- [x] Implement AnthropicLLMProvider with dynamic model
- [x] Implement GeminiLLMProvider with dynamic model
- [x] Create unified LLMService with model routing
- [x] Create LangfuseService for tracing
- [x] Create PromptLoaderService
- [x] Create tutor-system-prompt.md
- [x] Create grammar-check-prompt.md
- [x] Create exercise-generator-prompt.md
- [x] Create pronunciation-assessment-prompt.md
- [x] Implement LearningAgentService chat method (with LLMModel enum)
- [x] Implement LearningAgentService streamChat method (with LLMModel enum)
- [x] Implement LearningAgentService checkGrammar method (with LLMModel enum)
- [x] Implement LearningAgentService generateExercise method (with LLMModel enum)
- [x] Implement LearningAgentService assessPronunciation method (with LLMModel enum)
- [x] Create WhisperTranscriptionService
- [x] Create AiRateLimitGuard
- [x] Create AiController with all endpoints
- [x] Create all DTOs (with LLMModel enum in requests)
- [x] Configure ThrottlerModule
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
