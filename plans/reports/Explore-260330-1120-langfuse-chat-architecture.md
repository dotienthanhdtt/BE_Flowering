# Langfuse Tracing & AI Chat Flow Architecture

**Date**: 2026-03-30  
**Project**: Flowering Backend  
**Focus**: Langfuse v5 tracing setup, AI conversation flow, session/trace grouping

---

## 1. Langfuse Tracing Setup

### 1.1 Core Configuration (`src/instrument.ts`)

**How it works:**
- Langfuse v5 uses OpenTelemetry (OTel) for tracing
- Must initialize BEFORE Sentry (both register OTel globals)
- `LangfuseSpanProcessor` is registered to export spans to Langfuse cloud

**Key points:**
- Base URL resolves from `LANGFUSE_BASE_URL` or `LANGFUSE_HOST` env var (defaults to `https://cloud.langfuse.com`)
- Enabled only when BOTH `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are present
- Graceful shutdown on SIGTERM flushes pending traces (see `main.ts` line 50-54)

```typescript
// Enabled check
const langfuseEnabled = !!process.env.LANGFUSE_PUBLIC_KEY && !!process.env.LANGFUSE_SECRET_KEY;

// SDK initialization
if (langfuseEnabled) {
  langfuseSdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
  });
  langfuseSdk.start();
}
```

### 1.2 Langfuse Service (`src/modules/ai/services/langfuse-tracing.service.ts`)

**Purpose**: Provides CallbackHandler for LangChain integrations

**Key method:**
```typescript
getHandler(metadata?: Record<string, unknown>): CallbackHandler {
  return new CallbackHandler({
    userId: metadata?.userId as string | undefined,
    sessionId: metadata?.conversationId as string | undefined,  // Maps conversationId → sessionId!
    tags: metadata?.feature ? [metadata.feature as string] : undefined,
  });
}
```

**Important**: Conversation ID is mapped to Langfuse `sessionId` for dashboard grouping.

---

## 2. Database Entities

### 2.1 AiConversation (`src/database/entities/ai-conversation.entity.ts`)

```typescript
@Entity('ai_conversations')
export class AiConversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;  // Primary key, passed to Langfuse as sessionId

  @Column(type: 'uuid', nullable: true)
  userId?: string | null;  // Links to User (nullable for anonymous)

  @Column(type: 'uuid', nullable: true)
  languageId?: string | null;  // Links to Language (nullable for anonymous)

  @Column(type: 'varchar', length: 255, unique: true, nullable: true)
  sessionToken?: string;  // For anonymous sessions

  @Column(type: 'enum', default: 'authenticated')
  type!: AiConversationType;  // 'anonymous' | 'authenticated'

  @Column(type: 'timestamptz', nullable: true)
  expiresAt?: Date | null;  // Session expiration (anonymous)

  @Column(type: 'varchar')
  title?: string;  // User-facing session title

  @Column(type: 'varchar')
  topic?: string;  // Conversation topic/lesson area

  @Column(type: 'int', default: 0)
  messageCount!: number;  // Track conversation length

  @Column(type: 'jsonb', nullable: true)
  metadata?: Record<string, unknown>;  // Flexible storage for session metadata

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

enum AiConversationType {
  ANONYMOUS = 'anonymous',  // Anonymous users (no user_id)
  AUTHENTICATED = 'authenticated',  // Authenticated users
}
```

**Schema** (from migration 1706976000000):
```sql
CREATE TABLE "ai_conversations" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
  "language_id" UUID REFERENCES "languages"("id") ON DELETE CASCADE,
  "title" VARCHAR(255),
  "topic" VARCHAR(100),
  "message_count" INTEGER DEFAULT 0,
  "metadata" JSONB,
  "session_token" VARCHAR(255) UNIQUE (indexed),
  "type" ai_conversation_type_enum DEFAULT 'authenticated',
  "expires_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX "idx_ai_conversations_user_id" ON "ai_conversations"("user_id");
CREATE INDEX "idx_ai_conversations_type" ON "ai_conversations"("type");
CREATE UNIQUE INDEX "IDX_ai_conversations_session_token" ON "ai_conversations"("session_token") WHERE "session_token" IS NOT NULL;
```

### 2.2 AiConversationMessage (`src/database/entities/ai-conversation-message.entity.ts`)

```typescript
@Entity('ai_conversation_messages')
export class AiConversationMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column(type: 'uuid')
  conversationId!: string;  // FK to AiConversation

  @Column(type: 'enum')
  role!: MessageRole;  // 'user' | 'assistant' | 'system'

  @Column(type: 'text')
  content!: string;  // Message text

  @Column(type: 'text', nullable: true)
  audioUrl?: string;  // For audio-based messages (future)

  @Column(type: 'jsonb', nullable: true)
  metadata?: Record<string, unknown>;  // Flexible message metadata

  @Column(type: 'text', nullable: true)
  translatedContent?: string;  // Translated version of message

  @Column(type: 'varchar', length: 10, nullable: true)
  translatedLang?: string;  // Language code of translation

  @CreateDateColumn()
  createdAt!: Date;
}

enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}
```

**Schema** (from migration 1706976000000):
```sql
CREATE TABLE "ai_conversation_messages" (
  "id" UUID PRIMARY KEY,
  "conversation_id" UUID NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "role" message_role_enum NOT NULL,
  "content" TEXT NOT NULL,
  "audio_url" TEXT,
  "metadata" JSONB,
  "translated_content" TEXT,
  "translated_lang" VARCHAR(10),
  "created_at" TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX "idx_ai_conversation_messages_conversation_id" ON "ai_conversation_messages"("conversation_id");
```

---

## 3. Chat Flow Architecture

### 3.1 API Endpoints (`src/modules/ai/ai.controller.ts`)

All endpoints require authentication (global JWT guard) and premium subscription (PremiumGuard).

#### POST `/ai/chat` - Non-streaming chat
```typescript
@Post('chat')
async chat(@CurrentUser() user: User, @Body() dto: ChatRequestDto): Promise<ChatResponseDto>
```

#### SSE `/ai/chat/stream` - Streaming chat response
```typescript
@Sse('chat/stream')
streamChat(@CurrentUser() user: User, @Body() dto: ChatRequestDto): Observable<MessageEvent>
```

#### POST `/ai/chat/correct` - Grammar/vocabulary check (public)
```typescript
@Public()
@Post('chat/correct')
async checkCorrection(@Body() dto: CorrectionCheckRequestDto): Promise<CorrectionCheckResponseDto>
```

### 3.2 Request/Response DTOs

**ConversationContext** (required by chat endpoints):
```typescript
export class ConversationContext {
  conversationId: string;  // UUID - session identifier (maps to Langfuse sessionId!)
  targetLanguage: string;  // "Japanese", "Spanish", etc.
  nativeLanguage: string;  // "Vietnamese", etc.
  proficiencyLevel: string;  // 'beginner' | 'elementary' | 'intermediate' | 'upper-intermediate' | 'advanced'
  lessonTopic?: string;  // Optional: current lesson topic
}
```

**ChatRequestDto**:
```typescript
export class ChatRequestDto {
  message: string;  // User message (max 4000 chars)
  context: ConversationContext;
  model?: LLMModel;  // Optional: override default model (Gemini 2.0 Flash)
}
```

**ChatResponseDto**:
```typescript
export class ChatResponseDto {
  message: string;  // AI tutor response
  conversationId: string;  // Echo back session ID
}
```

---

## 4. Chat Processing Flow

### 4.1 LearningAgentService (`src/modules/ai/services/learning-agent.service.ts`)

**Main chat method flow:**

```typescript
async chat(userId: string, message: string, context: ConversationContext, model?: LLMModel)
  → Load system prompt with context (language, proficiency, topic)
  → Fetch conversation history (last 20 messages, ordered by created_at ASC)
  → Build LangChain message list: [SystemMessage, ...history, HumanMessage(user input)]
  → Call UnifiedLLMService.chat() with metadata containing userId, feature, conversationId
  → Save USER message to DB
  → Save ASSISTANT response to DB
  → Increment messageCount by 2
  → Return { message, conversationId }
```

**Streaming chat method flow:**

```typescript
async *streamChat(userId: string, message: string, context: ConversationContext, model?: LLMModel)
  → Load system prompt with context
  → Fetch conversation history (same as above)
  → Stream from UnifiedLLMService.stream() yielding chunks
  → After streaming completes, save both messages to DB
  → Increment messageCount
```

**Key implementation details:**
- Passes metadata object to LLM service: `{ userId, feature: 'chat'|'chat-stream', conversationId }`
- Uses conversationId as Langfuse sessionId for grouping traces
- Conversation history limited to 20 messages to manage context window
- Messages saved to DB AFTER generation (for streaming, after full response)

### 4.2 Unified LLM Service (`src/modules/ai/services/unified-llm.service.ts`)

Routes requests to appropriate provider based on LLMModel enum:
- OpenAI → OpenAILLMProvider
- Anthropic → AnthropicLLMProvider
- Gemini → GeminiLLMProvider

Each provider creates a LangChain model with Langfuse callback handler.

### 4.3 LLM Providers (OpenAI, Anthropic, Gemini)

**Pattern (all three providers follow same pattern):**

```typescript
private createModel(modelName: string, options?: LLMOptions): ChatOpenAI {
  return new ChatOpenAI({
    modelName,
    apiKey,
    temperature: options?.temperature ?? 0.7,
    maxTokens: options?.maxTokens,
    streaming: true,
    callbacks: [this.langfuseService.getHandler(options?.metadata)],  // ← Langfuse hook
  });
}

async chat(messages: BaseMessage[], options: LLMOptions): Promise<string> {
  const model = this.createModel(options.model, options);
  const response = await model.invoke(messages, {
    metadata: options.metadata,  // Passed through
    runName: (options.metadata?.feature as string) || undefined,
  });
  return response.content;
}

async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string> {
  const model = this.createModel(options.model, options);
  for await (const chunk of model.stream(messages, { metadata, runName })) {
    yield chunk.content;
  }
}
```

---

## 5. Session/Trace Grouping Logic

### 5.1 Current Implementation

**Grouping mechanism:**
1. Client passes `conversationId` (UUID) in ConversationContext
2. LearningAgentService extracts conversationId and passes it in metadata
3. LangfuseService.getHandler() maps metadata.conversationId → CallbackHandler.sessionId
4. LangChain's CallbackHandler tags all LLM calls with this sessionId
5. LangfuseSpanProcessor exports spans with sessionId to Langfuse
6. Langfuse dashboard groups all traces for a conversation under one sessionId

**Metadata passed to LLM providers:**
```typescript
{
  userId: string,           // User ID (mapped to Langfuse userId)
  feature: 'chat'|'chat-stream'|'correction-check',  // Feature tag
  conversationId: string,   // Session/conversation ID (mapped to Langfuse sessionId)
}
```

### 5.2 Database-Level Grouping

- All messages for a conversation stored in `ai_conversation_messages` table
- Indexed by `conversation_id` for fast retrieval
- Message ordering via `createdAt` (ascending)
- Message count tracked in `ai_conversations.messageCount`

### 5.3 Anonymous vs Authenticated Sessions

- **Authenticated**: `user_id` populated, `type: 'authenticated'`, `sessionToken: null`
- **Anonymous**: `user_id: null`, `type: 'anonymous'`, `sessionToken: unique string`
- Anonymous sessions expire via `expiresAt` field

---

## 6. Data Flow Diagram

```
HTTP Request (POST /ai/chat)
    ↓
AiController.chat()
    ↓
LearningAgentService.chat(userId, message, context, model)
    ↓
[Load system prompt + fetch conversation history]
    ↓
UnifiedLLMService.chat(messages, { model, metadata: {userId, conversationId, feature} })
    ↓
LLMProvider (OpenAI/Anthropic/Gemini)
    ↓
createModel(...) with callbacks: [langfuseService.getHandler(metadata)]
    ↓
LangChain ChatModel.invoke(messages, {metadata, runName})
    ↓
[LangChain CallbackHandler triggers]
    ↓
LangfuseSpanProcessor exports OTel spans to Langfuse
  ├─ userId: metadata.userId
  ├─ sessionId: metadata.conversationId
  └─ tags: [metadata.feature]
    ↓
[Save messages to DB]
    ↓
HTTP Response { message, conversationId }
```

---

## 7. Key Files & Locations

| File | Purpose |
|------|---------|
| `src/instrument.ts` | OTel SDK + Langfuse initialization |
| `src/main.ts` | App bootstrap, graceful shutdown for Langfuse |
| `src/modules/ai/services/langfuse-tracing.service.ts` | CallbackHandler factory |
| `src/modules/ai/services/learning-agent.service.ts` | Core chat logic, message persistence |
| `src/modules/ai/services/unified-llm.service.ts` | LLM provider routing |
| `src/modules/ai/providers/openai-llm.provider.ts` | OpenAI integration |
| `src/modules/ai/providers/anthropic-llm.provider.ts` | Anthropic integration |
| `src/modules/ai/providers/gemini-llm.provider.ts` | Gemini integration |
| `src/modules/ai/ai.controller.ts` | Chat endpoints |
| `src/modules/ai/dto/chat.dto.ts` | Request/response schemas |
| `src/database/entities/ai-conversation.entity.ts` | Session entity |
| `src/database/entities/ai-conversation-message.entity.ts` | Message entity |
| `src/database/migrations/1706976000000-initial-schema.ts` | DB schema creation |
| `src/database/migrations/1740000000000-add-onboarding-to-ai-conversations.ts` | Schema updates for anonymous sessions |

---

## 8. Architecture Strengths

1. **Unified tracing**: Single Langfuse handler across all LLM providers
2. **Session grouping**: Conversation ID maps directly to Langfuse sessionId
3. **Clean separation**: LLM providers don't know about Langfuse internals
4. **Streaming support**: Full support for both streaming and non-streaming with tracing
5. **Anonymous support**: Schema supports anonymous + authenticated sessions
6. **Graceful shutdown**: Traces flushed on SIGTERM
7. **Feature tagging**: Each LLM call tagged with feature name for dashboard filtering

---

## 9. Questions & Gaps

1. **Metadata enrichment**: `AiConversationMessage.metadata` is flexible JSONB but currently unused. Could store:
   - Model name used
   - Token usage stats
   - Latency metrics
   - Feature tags for analytics

2. **Conversation retrieval**: No endpoint to list user's conversations or fetch specific conversation details

3. **Session expiration**: Anonymous sessions have `expiresAt` but no cleanup job documented

4. **Langfuse dashboard filtering**: Are we using all available Langfuse features (cost tracking, performance monitoring, prompt versioning)?

5. **Context window management**: Hard-coded to 20 messages. Should this be configurable per conversation?

6. **Error tracing**: Are errors/exceptions being traced to Langfuse? Need to verify exception handling in providers.

---

**Report Generated**: 2026-03-30 11:20 UTC
