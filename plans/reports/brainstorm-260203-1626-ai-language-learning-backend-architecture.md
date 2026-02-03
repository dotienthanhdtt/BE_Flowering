# Brainstorm Report: AI Language Learning Backend Architecture

**Date:** 2026-02-03
**Project:** be_flowering (AI Language Learning App Backend)
**Status:** Consensus Reached

---

## Problem Statement

Design a quality, expandable NestJS backend for an AI-powered language learning app supporting multiple languages, with LangChain agents, Supabase database, and deployment to Railway.

---

## Requirements Summary

| Category | Decision |
|----------|----------|
| Framework | NestJS with MVC architecture |
| Languages | 2-3 initially (expandable) |
| AI Features | Full suite: tutor, pronunciation, grammar, exercises |
| Target Scale | 1,000 - 10,000 users |
| Real-time | Push notifications only (no WebSocket) |
| Auth | Social OAuth + Email/Password via JWT |
| LLM Provider | Multi-provider via LangChain abstraction |
| AI Monitoring | Langfuse for tracing |
| Payment | RevenueCat subscriptions |
| Storage | Supabase Storage for audio/media |
| Database | Supabase PostgreSQL, 5NF design |
| Clients | Mobile (Flutter/React Native) |
| Monitoring | Sentry for errors, logs, metrics |
| Deploy | Railway (dev + prod environments) |
| **Prompts** | **Store in `.md` files (version controlled, easy to edit)** |
| **API Docs** | **Swagger/OpenAPI auto-generated documentation** |

---

## Evaluated Approaches

### Agent Architecture

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| Single versatile agent | Simple, cheap, fast to build | Less specialized, prompt complexity | **Selected for MVP** |
| Specialized agents per task | Better quality per domain | Higher cost, complex orchestration | Phase 2 evolution |
| Orchestrator + Specialists | Best quality, clear separation | Most complex, highest cost | Phase 3 if needed |

### LLM Cost Strategy

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| Quality first (GPT-4o) | Best responses | ~$0.50-1.00/session | Too expensive |
| Cost-optimized (4o-mini) | Cheap | May lack quality for tutoring | Insufficient |
| **Tiered mix** | Balance quality/cost | Classification logic needed | **Selected** |

### Database

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Supabase all-in-one** | Integrated auth, storage, realtime, free tier | Vendor lock-in | **Selected** - mitigate with abstraction |
| Self-hosted Postgres | Full control | More ops work | Overkill for scale |

---

## Final Recommended Solution

### 1. Project Structure (MVC + Modular)

```
src/
├── config/
│   ├── database.config.ts
│   ├── auth.config.ts
│   ├── ai.config.ts
│   └── sentry.config.ts
├── common/
│   ├── decorators/
│   ├── filters/
│   │   └── http-exception.filter.ts    # Standard response format
│   ├── guards/
│   │   └── jwt-auth.guard.ts
│   ├── interceptors/
│   │   └── response-transform.interceptor.ts
│   └── dto/
│       └── base-response.dto.ts
├── swagger/                               # Swagger/OpenAPI config
│   └── swagger.config.ts
├── modules/
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── strategies/
│   │   │   ├── jwt.strategy.ts
│   │   │   ├── google.strategy.ts
│   │   │   └── apple.strategy.ts
│   │   └── dto/
│   ├── user/
│   │   ├── user.controller.ts
│   │   ├── user.service.ts
│   │   └── entities/user.entity.ts
│   ├── language/
│   │   ├── language.controller.ts
│   │   ├── language.service.ts
│   │   └── entities/
│   ├── lesson/
│   │   ├── lesson.controller.ts
│   │   ├── lesson.service.ts
│   │   └── entities/
│   ├── progress/
│   │   ├── progress.controller.ts
│   │   ├── progress.service.ts
│   │   └── entities/
│   ├── subscription/
│   │   ├── subscription.controller.ts
│   │   ├── subscription.service.ts    # RevenueCat webhook handler
│   │   └── entities/
│   ├── notification/
│   │   ├── notification.service.ts    # Firebase Cloud Messaging
│   │   └── entities/
│   └── ai/
│       ├── ai.module.ts
│       ├── ai.controller.ts
│       ├── agents/
│       │   └── learning-agent.service.ts
│       ├── prompts/                          # AI prompts stored as .md files
│       │   ├── tutor-system-prompt.md
│       │   ├── grammar-check-prompt.md
│       │   ├── exercise-generator-prompt.md
│       │   └── pronunciation-assessment-prompt.md
│       ├── providers/
│       │   ├── llm-provider.interface.ts
│       │   ├── openai.provider.ts
│       │   ├── anthropic.provider.ts
│       │   └── tiered-llm.provider.ts
│       ├── tools/
│       │   ├── grammar-check.tool.ts
│       │   ├── translation.tool.ts
│       │   └── exercise-generator.tool.ts
│       └── services/
│           └── langfuse.service.ts
└── database/
    ├── entities/
    └── migrations/
```

### 2. Database Schema (5NF)

```sql
-- Core entities
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  auth_provider VARCHAR(50),  -- 'email', 'google', 'apple'
  provider_id VARCHAR(255),
  display_name VARCHAR(100),
  avatar_url TEXT,
  native_language_id UUID REFERENCES languages(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE languages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(10) UNIQUE NOT NULL,  -- 'en', 'vi', 'ja'
  name VARCHAR(100) NOT NULL,
  native_name VARCHAR(100),
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE user_languages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  language_id UUID REFERENCES languages(id),
  proficiency_level VARCHAR(10) DEFAULT 'beginner',  -- 'beginner', 'intermediate', 'advanced'
  started_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, language_id)
);

CREATE TABLE lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  language_id UUID REFERENCES languages(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  difficulty_level INTEGER DEFAULT 1,
  order_index INTEGER,
  content JSONB,  -- Lesson structure
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,  -- 'multiple_choice', 'fill_blank', 'pronunciation', 'translation'
  question JSONB NOT NULL,
  correct_answer JSONB NOT NULL,
  order_index INTEGER
);

CREATE TABLE user_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  lesson_id UUID REFERENCES lessons(id),
  status VARCHAR(20) DEFAULT 'not_started',  -- 'not_started', 'in_progress', 'completed'
  score DECIMAL(5,2),
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, lesson_id)
);

CREATE TABLE user_exercise_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES exercises(id),
  user_answer JSONB,
  is_correct BOOLEAN,
  feedback TEXT,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  revenuecat_id VARCHAR(255) UNIQUE,
  plan_type VARCHAR(50),  -- 'free', 'monthly', 'yearly'
  status VARCHAR(50),  -- 'active', 'expired', 'cancelled'
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  language_id UUID REFERENCES languages(id),
  context VARCHAR(50),  -- 'tutor', 'practice', 'grammar'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,  -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  metadata JSONB,  -- langfuse trace_id, tokens, etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform VARCHAR(20),  -- 'ios', 'android'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, token)
);

-- Indexes
CREATE INDEX idx_user_progress_user ON user_progress(user_id);
CREATE INDEX idx_lessons_language ON lessons(language_id);
CREATE INDEX idx_ai_conversations_user ON ai_conversations(user_id);
```

### 3. AI Agent Design (Phase 1 - Single Agent)

```typescript
// src/modules/ai/agents/learning-agent.service.ts
@Injectable()
export class LearningAgentService {
  constructor(
    private readonly llmProvider: TieredLLMProvider,
    private readonly langfuseService: LangfuseService,
  ) {}

  // Main tutoring conversation
  async chat(userId: string, message: string, context: ConversationContext): Promise<AgentResponse> {
    // Uses complex model (GPT-4o) for quality tutoring
    return this.llmProvider.complex.chat(...)
  }

  // Grammar checking
  async checkGrammar(text: string, targetLanguage: string): Promise<GrammarResult> {
    // Uses simple model (GPT-4o-mini) - straightforward task
    return this.llmProvider.simple.chat(...)
  }

  // Exercise generation
  async generateExercise(params: ExerciseParams): Promise<Exercise> {
    // Uses complex model - needs creativity
    return this.llmProvider.complex.chat(...)
  }

  // Pronunciation assessment (requires audio transcription first)
  async assessPronunciation(audioUrl: string, expectedText: string): Promise<PronunciationScore> {
    // Simple model for comparison scoring
    return this.llmProvider.simple.chat(...)
  }
}
```

### 4. LLM Provider Abstraction

```typescript
// src/modules/ai/providers/llm-provider.interface.ts
export interface LLMProvider {
  chat(messages: ChatMessage[], options?: LLMOptions): Promise<string>
  stream(messages: ChatMessage[]): AsyncIterable<string>
}

// src/modules/ai/providers/tiered-llm.provider.ts
@Injectable()
export class TieredLLMProvider {
  simple: LLMProvider   // GPT-4o-mini / Claude Haiku
  complex: LLMProvider  // GPT-4o / Claude Sonnet

  constructor(configService: ConfigService) {
    const provider = configService.get('LLM_PROVIDER') // 'openai' | 'anthropic'
    // Initialize based on config
  }
}
```

### 5. Prompt Management (Markdown Files)

AI prompts stored as `.md` files for:
- **Version control:** Track prompt changes in git
- **Easy editing:** Non-developers can modify prompts
- **Hot reload:** Update prompts without code deploy (optional)

```
src/modules/ai/prompts/
├── tutor-system-prompt.md
├── grammar-check-prompt.md
├── exercise-generator-prompt.md
└── pronunciation-assessment-prompt.md
```

**Example: `tutor-system-prompt.md`**
```markdown
# Language Tutor System Prompt

You are a friendly, patient language tutor helping users learn {{targetLanguage}}.

## Your Role
- Engage in natural conversation at the user's level ({{proficiencyLevel}})
- Correct mistakes gently with explanations
- Provide vocabulary and grammar tips contextually
- Encourage and motivate the learner

## Guidelines
- Use {{targetLanguage}} primarily, with {{nativeLanguage}} explanations when needed
- Keep responses concise (2-4 sentences for beginners)
- Ask follow-up questions to keep conversation flowing
- Celebrate progress and correct errors constructively

## User Context
- Native language: {{nativeLanguage}}
- Learning: {{targetLanguage}}
- Level: {{proficiencyLevel}}
- Current lesson topic: {{lessonTopic}}
```

**Prompt Loader Service:**
```typescript
// src/modules/ai/services/prompt-loader.service.ts
@Injectable()
export class PromptLoaderService {
  private readonly promptsDir = join(__dirname, '../prompts');

  async loadPrompt(name: string, variables: Record<string, string>): Promise<string> {
    const filePath = join(this.promptsDir, `${name}.md`);
    let content = await readFile(filePath, 'utf-8');

    // Replace {{variable}} placeholders
    for (const [key, value] of Object.entries(variables)) {
      content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return content;
  }
}
```

### 6. Standard Response Format

```typescript
// src/common/interceptors/response-transform.interceptor.ts
@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(data => ({
        code: 1,
        message: 'Success',
        data: data
      }))
    );
  }
}

// src/common/filters/http-exception.filter.ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // Transform to { code: 0, message: '...', data: null }
    // Log to Sentry
  }
}
```

### 7. Swagger/OpenAPI Configuration

```typescript
// src/swagger/swagger.config.ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('AI Language Learning API')
    .setDescription('Backend API for AI-powered language learning app')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Authentication endpoints')
    .addTag('users', 'User management')
    .addTag('languages', 'Language/course data')
    .addTag('lessons', 'Lessons and exercises')
    .addTag('progress', 'User progress tracking')
    .addTag('ai', 'AI tutoring and learning agents')
    .addTag('subscriptions', 'Subscription management')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}
```

**DTO Example with Swagger decorators:**
```typescript
// src/modules/ai/dto/chat-request.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class ChatRequestDto {
  @ApiProperty({ description: 'User message to AI tutor', example: 'How do I say hello in Japanese?' })
  @IsString()
  message: string;

  @ApiProperty({ description: 'Conversation ID for context', required: false })
  @IsUUID()
  conversationId?: string;
}
```

**Swagger UI available at:** `GET /api/docs`

### 8. Environment Configuration

```
# .env.development
NODE_ENV=development
DATABASE_URL=postgresql://...supabase-dev...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...

JWT_SECRET=dev-secret
JWT_EXPIRY=7d

OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
LLM_PROVIDER=openai
LLM_SIMPLE_MODEL=gpt-4o-mini
LLM_COMPLEX_MODEL=gpt-4o

LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com

SENTRY_DSN=https://...@sentry.io/...

REVENUECAT_API_KEY=...
REVENUECAT_WEBHOOK_SECRET=...

FIREBASE_PROJECT_ID=...
FIREBASE_PRIVATE_KEY=...
FIREBASE_CLIENT_EMAIL=...
```

---

## Key Packages

```json
{
  "dependencies": {
    "@nestjs/common": "^11.x",
    "@nestjs/config": "^3.x",
    "@nestjs/passport": "^11.x",
    "@nestjs/jwt": "^11.x",
    "@nestjs/swagger": "^8.x",
    "@supabase/supabase-js": "^2.x",
    "passport-jwt": "^4.x",
    "passport-google-oauth20": "^2.x",
    "@langchain/core": "^0.3.x",
    "@langchain/openai": "^0.3.x",
    "@langchain/anthropic": "^0.3.x",
    "@langfuse/langchain": "^3.x",
    "@sentry/nestjs": "^8.x",
    "firebase-admin": "^12.x",
    "class-validator": "^0.14.x",
    "class-transformer": "^0.5.x"
  }
}
```

---

## Implementation Considerations

### Security
- JWT tokens with refresh mechanism
- Rate limiting on AI endpoints (cost control)
- Input sanitization for all user inputs
- Row-level security in Supabase

### Performance
- Redis caching for lesson content (add later if needed)
- Pagination on all list endpoints
- Streaming responses for AI chat

### Monitoring
- Sentry for error tracking and performance
- Langfuse for AI agent tracing
- Health check endpoints for Railway

---

## Success Metrics

1. **API Response Time:** < 200ms for non-AI endpoints
2. **AI Response Time:** < 3s for chat, < 1s for grammar check
3. **Error Rate:** < 1% for all endpoints
4. **Test Coverage:** > 80% for critical paths

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| LLM API costs exceed budget | Medium | High | Tiered model strategy, usage monitoring |
| Supabase vendor lock-in | Low | Medium | Abstraction layer, can migrate if needed |
| RevenueCat mobile-only | Low | Low | Target is mobile-first anyway |
| Complex agent evolution | Medium | Medium | Clear upgrade path designed |

---

## Next Steps

1. **Initialize NestJS project** with TypeScript strict mode
2. **Configure Supabase** connection and migrations
3. **Implement auth module** (JWT + OAuth strategies)
4. **Build AI module** with single agent
5. **Add Sentry + Langfuse** integration
6. **Deploy to Railway** with dev/prod environments

---

## Unresolved Questions

1. Audio transcription provider for pronunciation (Whisper API vs alternatives)?
2. Specific OAuth providers priority (Google, Apple, Facebook)?
3. Content management for lessons (admin panel or seed scripts)?
