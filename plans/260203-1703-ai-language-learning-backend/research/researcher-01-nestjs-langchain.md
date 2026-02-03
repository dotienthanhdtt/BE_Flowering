# NestJS + LangChain Integration Research Report

**Date:** 2026-02-03
**Topics:** NestJS 11 + LangChain 0.3, Tiered LLM routing, Langfuse tracing, Prompt management, Streaming

---

## 1. NestJS 11 + LangChain 0.3 Integration

### Installation
```bash
npm install @langchain/openai @langchain/core langchain
npm install langfuse-langchain  # For tracing
```

### Injectable LangChain Service Pattern
```typescript
// ai/ai.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';

@Module({
  imports: [ConfigModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}

// ai/ai.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { CallbackHandler } from 'langfuse-langchain';

@Injectable()
export class AiService {
  private readonly langfuseHandler: CallbackHandler;

  constructor(private configService: ConfigService) {
    // Initialize Langfuse tracing
    this.langfuseHandler = new CallbackHandler({
      secretKey: this.configService.get('LANGFUSE_SECRET_KEY'),
      publicKey: this.configService.get('LANGFUSE_PUBLIC_KEY'),
      baseUrl: this.configService.get('LANGFUSE_HOST'),
      flushAt: 1,
      flushInterval: 1000,
    });
  }

  createChatModel(model: string) {
    return new ChatOpenAI({
      modelName: model,
      openAIApiKey: this.configService.get('OPENAI_API_KEY'),
      callbacks: [this.langfuseHandler],
      streaming: true, // Enable streaming
    });
  }
}
```

---

## 2. Tiered LLM Provider Routing Pattern

### Approach A: Fallback Chain (Error-based)
Auto-fallback when primary model fails (rate limits, errors).

```typescript
import { ChatOpenAI } from '@langchain/openai';

// Primary with automatic fallback
const modelWithFallback = new ChatOpenAI({
  modelName: 'gpt-4o'
}).withFallbacks([
  new ChatOpenAI({ modelName: 'gpt-4o-mini' }),
]);
```

### Approach B: Conditional Routing (Complexity-based)
Route BEFORE execution based on input characteristics.

```typescript
import { RunnableBranch } from '@langchain/core/runnables';

// ai/ai.service.ts (continued)
createTieredChain() {
  const gpt4o = this.createChatModel('gpt-4o');
  const gpt4oMini = this.createChatModel('gpt-4o-mini');

  // Route based on complexity
  return new RunnableBranch([
    {
      condition: (input) => this.isComplex(input),
      runnable: gpt4o,
    },
    {
      condition: () => true, // Default
      runnable: gpt4oMini,
    },
  ]);
}

private isComplex(input: string): boolean {
  // Complexity heuristics
  return (
    input.length > 500 ||
    /explain|analyze|compare|evaluate/i.test(input)
  );
}
```

### Approach C: Manual Routing in Service Layer
```typescript
async chat(message: string, userId: string) {
  const complexity = this.assessComplexity(message);
  const model = complexity === 'high' ? 'gpt-4o' : 'gpt-4o-mini';
  const chatModel = this.createChatModel(model);

  return await chatModel.invoke(message, {
    metadata: { userId, complexity }, // For Langfuse tracking
  });
}

private assessComplexity(message: string): 'high' | 'low' {
  // Custom logic: length, keywords, user tier, etc.
  if (message.length > 300) return 'high';
  if (/complex|detailed|comprehensive/i.test(message)) return 'high';
  return 'low';
}
```

---

## 3. Langfuse Integration for Tracing

### Setup
```typescript
// .env
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
```

### Per-Request Metadata Tracking
```typescript
import { CallbackHandler } from 'langfuse-langchain';

// Add user context to traces
const response = await chatModel.invoke(prompt, {
  callbacks: [this.langfuseHandler],
  metadata: {
    userId: 'user123',
    sessionId: 'session456',
    modelTier: 'gpt-4o-mini',
    feature: 'conversation',
  },
});
```

### Benefits
- Trace LLM calls, chains, agents
- Monitor costs per user/session
- Debug prompt performance
- A/B test prompts
- Analyze latency bottlenecks

---

## 4. Prompt Management with Markdown Files

### File Structure
```
src/ai/prompts/
├── system/
│   ├── tutor.md
│   └── conversation.md
├── user/
│   ├── grammar-check.md
│   └── vocabulary-quiz.md
└── index.ts
```

### Loading Prompts from Files
```typescript
// ai/prompts/index.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { PromptTemplate } from '@langchain/core/prompts';

export class PromptLoader {
  private static cache = new Map<string, PromptTemplate>();

  static load(name: string, variables: string[]): PromptTemplate {
    if (this.cache.has(name)) {
      return this.cache.get(name)!;
    }

    const filePath = join(__dirname, `${name}.md`);
    const template = readFileSync(filePath, 'utf-8');

    const promptTemplate = PromptTemplate.fromTemplate(template, {
      templateFormat: 'f-string', // {variable} syntax
    });

    this.cache.set(name, promptTemplate);
    return promptTemplate;
  }
}

// Usage in service
const tutorPrompt = PromptLoader.load('system/tutor', ['language', 'level']);
const formatted = await tutorPrompt.format({
  language: 'Spanish',
  level: 'Beginner',
});
```

### Example Prompt File (`tutor.md`)
```markdown
You are an expert {language} tutor for {level} students.

Your teaching style:
- Patient and encouraging
- Use simple vocabulary for {level} level
- Provide examples in {language}

Current topic: {topic}
Student question: {question}
```

### Variable Substitution
- Use `{variable_name}` syntax
- Pass variables via `.format()` method
- Support nested variables and conditionals via custom logic

---

## 5. Streaming AI Responses in NestJS

### SSE Controller Pattern
```typescript
// ai/ai.controller.ts
import { Controller, Post, Body, Sse, MessageEvent } from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';

@Controller('ai')
export class AiController {
  constructor(private aiService: AiService) {}

  @Sse('chat/stream')
  async streamChat(@Body() dto: ChatDto): Promise<Observable<MessageEvent>> {
    const stream = await this.aiService.streamChat(dto.message);

    // Convert async generator to Observable
    return from(this.asyncIteratorToArray(stream)).pipe(
      map((chunk) => ({
        data: { content: chunk },
        type: 'message',
      })),
    );
  }

  private async *asyncIteratorToArray(iterator: AsyncIterable<string>) {
    for await (const chunk of iterator) {
      yield chunk;
    }
  }
}

// ai/ai.service.ts (streaming method)
async *streamChat(message: string): AsyncIterable<string> {
  const model = this.createChatModel('gpt-4o-mini');
  const stream = await model.stream(message);

  for await (const chunk of stream) {
    yield chunk.content as string;
  }
}
```

### Alternative: Manual Response Streaming
```typescript
@Post('chat/stream')
async streamChatManual(@Res() res: Response, @Body() dto: ChatDto) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const stream = await this.aiService.streamChat(dto.message);

  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
  }

  res.end();
}
```

### Client-Side Consumption (EventSource)
```typescript
const eventSource = new EventSource('/ai/chat/stream');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Chunk:', data.content);
};

eventSource.onerror = () => {
  eventSource.close();
};
```

---

## Key Recommendations

1. **Module Structure**: Separate AI module with injectable services
2. **Tiered Routing**: Use manual complexity assessment in service layer (simpler than RunnableBranch for basic cases)
3. **Tracing**: Integrate Langfuse from start; invaluable for debugging/monitoring
4. **Prompts**: Store in `.md` files, cache PromptTemplate instances, use consistent variable naming
5. **Streaming**: Use NestJS `@Sse` decorator with async generators; cleaner than manual response handling

---

## Unresolved Questions

1. **Prompt versioning**: How to version prompts across deployments? (Git tags? Database?)
2. **Langfuse costs**: Self-hosted vs cloud pricing for production scale?
3. **Model routing metrics**: What complexity scoring algorithm works best for language learning tasks?
4. **Streaming error handling**: Best pattern for mid-stream errors (partial responses)?
5. **Prompt hot-reload**: Should prompts support hot-reload in dev/prod?
