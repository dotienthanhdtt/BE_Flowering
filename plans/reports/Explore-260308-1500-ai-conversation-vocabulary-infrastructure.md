# Exploration Report: AI Conversation & Vocabulary Infrastructure

**Date:** 2026-03-08
**Scope:** Backend (`be_flowering/`) AI conversation entity, vocabulary support, AI module architecture, onboarding module

---

## 1. AI Conversation Message Entity

**File:** `/src/database/entities/ai-conversation-message.entity.ts`

```typescript
@Entity('ai_conversation_messages')
export class AiConversationMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  
  @ManyToOne(() => AiConversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: AiConversation;
  
  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId!: string;
  
  @Column({ type: 'enum', enum: MessageRole })
  role!: MessageRole; // 'user' | 'assistant' | 'system'
  
  @Column({ type: 'text' })
  content!: string;
  
  @Column({ type: 'text', name: 'audio_url', nullable: true })
  audioUrl?: string;
  
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;
  
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

**Schema:** 13 columns including UUID PK, FK to ai_conversations, role enum, text content, optional audio URL, jsonb metadata, timestamps

---

## 2. AI Conversation Entity

**File:** `/src/database/entities/ai-conversation.entity.ts`

```typescript
@Entity('ai_conversations')
export class AiConversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  
  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user?: User | null; // Null for anonymous/onboarding sessions
  
  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId?: string | null;
  
  @ManyToOne(() => Language, { nullable: true })
  @JoinColumn({ name: 'language_id' })
  language?: Language | null;
  
  @Column({ type: 'uuid', name: 'language_id', nullable: true })
  languageId?: string | null;
  
  @Column({ type: 'varchar', length: 255, name: 'session_token', nullable: true, unique: true })
  sessionToken?: string | null; // For anonymous sessions
  
  @Column({
    type: 'enum',
    enum: AiConversationType,
    default: AiConversationType.AUTHENTICATED,
  })
  type!: AiConversationType; // 'anonymous' | 'authenticated'
  
  @Column({ type: 'timestamptz', name: 'expires_at', nullable: true })
  expiresAt?: Date | null; // TTL for anonymous sessions
  
  @Column({ type: 'varchar', length: 255, nullable: true })
  title?: string;
  
  @Column({ type: 'varchar', length: 100, nullable: true })
  topic?: string;
  
  @Column({ type: 'int', name: 'message_count', default: 0 })
  messageCount!: number;
  
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;
  
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

**Schema:** 15 columns; supports both authenticated (user_id + language_id) and anonymous (session_token + TTL) conversations; optional title, topic, message counter, jsonb metadata

---

## 3. Vocabulary/Translation Status

**Finding:** NO existing vocabulary table or entity found.

**Grep results:**
- Search for `vocabulary|vocab|translation` found only:
  - Exercise type enum includes `TRANSLATION` variant
  - `/src/database/migrations/1706976000000-initial-schema.ts` defines exercise types
  - `/src/modules/ai/dto/generate-exercise.dto.ts` references exercise generation

**Implication:** Vocabulary storage is **not yet implemented**. Full vocabulary table must be created as part of this feature.

---

## 4. AI Module Architecture

**Location:** `/src/modules/ai/`

### Services (6 total)

1. **UnifiedLLMService** (`unified-llm.service.ts`)
   - Routes requests to provider based on model enum
   - Methods: `chat()`, `stream()`
   - Single interface for all LLM operations

2. **LearningAgentService** (`learning-agent.service.ts`)
   - Main AI tutor logic; 268 lines
   - Key methods:
     - `createConversation(userId, dto)` - creates conversation
     - `chat(userId, message, context, model?)` - returns full response
     - `streamChat(userId, message, context, model?)` - yields chunks
     - `checkGrammar(text, targetLanguage, model?)` - grammar checking
     - `generateExercise(...)` - exercise generation
     - `assessPronunciation(...)` - pronunciation assessment
     - `getConversationHistory(conversationId)` - returns last 20 messages as BaseMessage[]
     - `getConversationMessages(conversationId)` - returns raw AiConversationMessage[]
     - `saveMessage(conversationId, role, content)` - private helper

3. **PromptLoaderService** (`prompt-loader.service.ts`)
   - Loads markdown prompts with variable substitution

4. **LangfuseService** (`langfuse-tracing.service.ts`)
   - Tracing/monitoring integration

5. **WhisperTranscriptionService** (`whisper-transcription.service.ts`)
   - Audio transcription

### LLM Providers (3 implementations)

1. **OpenAILLMProvider** (`openai-llm.provider.ts`) - GPT-4o, o1
2. **AnthropicLLMProvider** (`anthropic-llm.provider.ts`) - Claude 3.5 Sonnet, 3 Haiku
3. **GeminiLLMProvider** (`gemini-llm.provider.ts`) - Gemini 2.5 Flash, 2.0 Flash, 1.5 Pro/Flash

### LLM Models Enum

**File:** `providers/llm-models.enum.ts`

```typescript
export enum LLMModel {
  OPENAI_GPT4O = 'gpt-4o',
  OPENAI_GPT4O_MINI = 'gpt-4o-mini',
  OPENAI_O1_PREVIEW = 'o1-preview',
  OPENAI_O1_MINI = 'o1-mini',
  ANTHROPIC_CLAUDE_3_5_SONNET = 'claude-3-5-sonnet-20241022',
  ANTHROPIC_CLAUDE_3_HAIKU = 'claude-3-haiku-20240307',
  GEMINI_2_5_FLASH = 'gemini-2.5-flash-preview-05-20',
  GEMINI_2_0_FLASH = 'gemini-2.0-flash',
  GEMINI_1_5_PRO = 'gemini-1.5-pro',
  GEMINI_1_5_FLASH = 'gemini-1.5-flash',
}
```

Default model: `LLMModel.GEMINI_2_0_FLASH`

### Prompts (7 files)

Located in `/src/modules/ai/prompts/`:

1. `tutor-system-prompt.md` - Main tutoring system prompt
2. `grammar-check-prompt.md` - Grammar checking
3. `exercise-generator-prompt.md` - Exercise generation
4. `pronunciation-assessment-prompt.md` - Pronunciation assessment
5. `onboarding-chat-prompt.md` - Onboarding chat
6. `onboarding-extraction-prompt.md` - User profile extraction
7. `onboarding-scenarios-prompt.md` - Learning scenario generation

### AI Controller Endpoints

**File:** `/src/modules/ai/ai.controller.ts`

| Endpoint | Method | Auth | Summary |
|----------|--------|------|---------|
| `/ai/chat` | POST | JWT | Chat with AI tutor |
| `/ai/chat/stream` | SSE | JWT | Stream chat response |
| `/ai/grammar/check` | POST | ✓ | Check text grammar |
| `/ai/exercises/generate` | POST | ✓ | Generate language exercise |
| `/ai/pronunciation/assess` | POST | ✓ | Assess pronunciation from audio |
| `/ai/conversations` | POST | JWT | Create conversation session |
| `/ai/conversations/:id/messages` | GET | ✓ | Get conversation message history |

**Rate Limiting:** 20 req/min (short), 100 req/hour (medium) via ThrottlerGuard

---

## 5. Onboarding Module

**Location:** `/src/modules/onboarding/`

### Service: OnboardingService (213 lines)

**Key methods:**

1. `startSession(dto)` - Creates anonymous conversation with TTL, returns sessionToken + conversationId
2. `chat(dto)` - Handles onboarding chat turns (max turns configurable)
3. `complete(dto)` - Extraction phase; parses conversation transcript, generates 5 learning scenarios
4. Private helpers:
   - `findValidSession(sessionToken)` - Validates session exists and not expired
   - `getHistory(conversationId)` - Last 20 messages as BaseMessage[]
   - `saveMessage(...)` - Saves message to DB
   - `parseExtraction(response)` - Parses JSON from LLM response
   - `parseScenarios(response)` - Parses 5 scenarios from LLM response
   - `generateScenarios(profile, conversationId)` - Calls LLM for scenario generation

### Onboarding Configuration

**File:** `onboarding.config.ts`

```typescript
export const onboardingConfig = {
  sessionTtlDays: 7,
  maxTurns: 5,
  llmModel: LLMModel.GEMINI_2_0_FLASH,
  temperature: 0.7,
  maxTokens: 1024,
};
```

### DTOs

1. `StartOnboardingDto` - nativeLanguage, targetLanguage
2. `OnboardingChatDto` - sessionToken, message
3. `OnboardingCompleteDto` - sessionToken
4. `OnboardingScenarioDto` - id, title, description, icon, accentColor

### Endpoints

| Endpoint | Method | Auth | Summary |
|----------|--------|------|---------|
| `/onboarding/start` | POST | @Public | Start anonymous session |
| `/onboarding/chat` | POST | @Public | Chat during onboarding |
| `/onboarding/complete` | POST | @Public | Complete onboarding & extract profile |

---

## 6. Existing Database Migrations

**Location:** `/src/database/migrations/`

5 migration files exist:

1. **1706976000000-initial-schema.ts** - Creates base schema (languages, users, lessons, exercises, conversations, etc.)
   - Defines enum types (message_role_enum includes 'user', 'assistant', 'system')
   - Creates `ai_conversations` table with all fields
   - Creates `ai_conversation_messages` table with all fields
   - NO vocabulary table

2. **1738678400000-add-flag-url-to-languages.ts** - Adds flag_url to languages
3. **1740100000000-auth-improvements-provider-columns.ts** - Auth enhancements
4. **1740200000000-add-native-learning-flags-to-languages.ts** - Language flags
5. **1772277787300-create-password-resets-table.ts** - Password reset table

---

## 7. Current API Response Contract

**Pattern:** Global response wrapper via `ResponseTransformInterceptor`

```json
{
  "code": 1,
  "message": "Success message",
  "data": {
    "messages": [...],
    "conversationId": "uuid"
  }
}
```

**Error handling:** `AllExceptionsFilter` catches all errors; never exposes raw exceptions

---

## 8. Key Patterns & Data Flow

### Message Saving Flow

```typescript
// In LearningAgentService
await this.saveMessage(conversationId, MessageRole.USER, userMessage);
await this.saveMessage(conversationId, MessageRole.ASSISTANT, aiResponse);
await this.conversationRepo.increment({ id: conversationId }, 'messageCount', 2);
```

### Conversation History Retrieval

```typescript
// Last 20 messages for context
const messages = await this.messageRepo.find({
  where: { conversationId },
  order: { createdAt: 'ASC' },
  take: 20,
});
return messages.map((m) =>
  m.role === MessageRole.USER ? new HumanMessage(m.content) : new AIMessage(m.content),
);
```

### Exercise Type Enum

**File:** `/src/database/entities/exercise.entity.ts`

```typescript
export enum ExerciseType {
  MULTIPLE_CHOICE = 'multiple_choice',
  FILL_IN_BLANK = 'fill_in_blank',
  LISTENING = 'listening',
  SPEAKING = 'speaking',
  TRANSLATION = 'translation', // EXISTS but no vocab support
  MATCHING = 'matching',
}
```

---

## 9. Module Exports & Dependencies

### AiModule Exports

```typescript
export class AiModule {}
// Exports: UnifiedLLMService, LearningAgentService, PromptLoaderService
```

Used by:
- Onboarding module (imports UnifiedLLMService, PromptLoaderService)
- AI controller (uses LearningAgentService, WhisperTranscriptionService)

### Database Entities Currently Exported

**File:** `/src/database/entities/index.ts`

```typescript
export * from './language.entity';
export * from './user.entity';
export * from './user-language.entity';
export * from './lesson.entity';
export * from './exercise.entity';
export * from './user-progress.entity';
export * from './user-exercise-attempt.entity';
export * from './subscription.entity';
export * from './ai-conversation.entity';
export * from './ai-conversation-message.entity';
export * from './device-token.entity';
export * from './password-reset.entity';
```

---

## 10. Summary

### What Exists
- ✓ Conversation message entity with metadata support
- ✓ Conversation entity with anonymous + authenticated support
- ✓ Multi-provider LLM abstraction (OpenAI, Anthropic, Gemini)
- ✓ Learning agent service with chat, grammar, exercise, pronunciation features
- ✓ Onboarding module with session-based conversation
- ✓ Message persistence with timestamps, roles, optional audio/metadata
- ✓ History retrieval (last 20 messages for context)
- ✓ Prompt loading with variable substitution

### What's Missing
- ✗ No vocabulary entity/table
- ✗ No word/translation storage
- ✗ No vocabulary API endpoints
- ✗ No word-to-conversation linking
- ✗ No translation features (Exercise type exists but no storage)

### Architecture Ready For
- Adding vocabulary table (new entity, migration, DAO)
- Creating vocabulary endpoints (CRUD operations)
- Linking vocabulary to conversations/messages
- Storing translations in conversation metadata

---

## Unresolved Questions

1. Should vocabulary be user-specific (UserVocabulary) or shared (global)?
2. Should translations be stored per-language-pair or language-agnostic?
3. Should vocabulary relate to conversations, exercises, or standalone?
4. How to link words learned in conversations to vocabulary tracking?
5. Should pronunciation assessment save word-level accuracy metrics?

