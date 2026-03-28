# AI Module Dependency Analysis

## Executive Summary
Analysis of 4 endpoints to determine what can be safely deleted vs. shared dependencies:
- **DELETE-safe**: POST /ai/exercises/generate, POST /ai/pronunciation/assess, POST /ai/conversations, GET /ai/conversations/:id/messages
- **KEEP**: POST /ai/translate, POST /ai/chat, POST /ai/chat/correct (shared dependencies with onboarding)

---

## 1. TARGET ENDPOINTS (To Delete)

### Endpoint 1: POST /ai/exercises/generate

**Controller Method**: `generateExercise()` (lines 111-122)
```
Route: POST /ai/exercises/generate
Handler: generateExercise(@Body() dto: GenerateExerciseRequestDto)
```

**Request DTO**: `GenerateExerciseRequestDto`
- exerciseType: string
- targetLanguage: string
- proficiencyLevel: string
- topic: string
- model?: LLMModel (optional)

**Response DTO**: `ExerciseResult`
- type: string
- question: string
- options?: string[]
- correctAnswer: string
- explanation: string
- hints?: string[]

**Service Method Called**: `LearningAgentService.generateExercise()`
```typescript
async generateExercise(
  exerciseType: string,
  targetLanguage: string,
  proficiencyLevel: string,
  topic: string,
  model?: LLMModel,
): Promise<ExerciseResult>
```

**Service Implementation Details**:
- Calls `promptLoader.loadPrompt('exercise-generator-prompt', {...})`
- Calls `llmService.chat([HumanMessage], {model, metadata})`
- Parses JSON response with fallback to ExerciseResult defaults
- **Uses Entities**: None (no database operations)
- **Uses Repositories**: None
- **Dependencies**: UnifiedLLMService, PromptLoaderService

---

### Endpoint 2: POST /ai/pronunciation/assess

**Controller Method**: `assessPronunciation()` (lines 124-167)
```
Route: POST /ai/pronunciation/assess
Handler: assessPronunciation(@UploadedFile() audio, @Body() dto: PronunciationAssessmentRequestDto)
```

**Request DTO**: `PronunciationAssessmentRequestDto`
- expectedText: string
- targetLanguage: string
- model?: LLMModel (optional)

**Response DTO**: `PronunciationResult`
- score: number
- feedback: string
- errors: PronunciationError[]
- transcribedText?: string

**Service Methods Called**:
1. `WhisperTranscriptionService.transcribe(audio.buffer, targetLanguage)`
   - Calls OpenAI Whisper API directly
   - Returns transcribed text

2. `LearningAgentService.assessPronunciation()`
   ```typescript
   async assessPronunciation(
     transcribedText: string,
     expectedText: string,
     targetLanguage: string,
     model?: LLMModel,
   ): Promise<PronunciationResult>
   ```
   - Calls `promptLoader.loadPrompt('pronunciation-assessment-prompt', {...})`
   - Calls `llmService.chat([HumanMessage], {model, metadata})`
   - Parses JSON response with fallback to PronunciationResult defaults
   - **Uses Entities**: None
   - **Uses Repositories**: None
   - **Dependencies**: UnifiedLLMService, PromptLoaderService, WhisperTranscriptionService

---

### Endpoint 3: POST /ai/conversations

**Controller Method**: `createConversation()` (lines 195-203)
```
Route: POST /ai/conversations
Handler: createConversation(@CurrentUser() user, @Body() dto: CreateConversationDto)
Returns: { id: string }
```

**Request DTO**: `CreateConversationDto`
- languageId: UUID
- title?: string
- topic?: string
- metadata?: Record<string, unknown>

**Service Method Called**: `LearningAgentService.createConversation()`
```typescript
async createConversation(userId: string, dto: CreateConversationDto): Promise<AiConversation>
```

**Service Implementation Details**:
- Creates and saves AiConversation entity
- **Uses Entities**: AiConversation
- **Uses Repositories**: AiConversation repository
- **Dependencies**: None (only database operations)

**Database Dependency**: 
- **Entity**: AiConversation (ai_conversations table)
- **Repository**: conversationRepo: Repository<AiConversation>

---

### Endpoint 4: GET /ai/conversations/:id/messages

**Controller Method**: `getConversationMessages()` (lines 205-212)
```
Route: GET /ai/conversations/:id/messages
Handler: getConversationMessages(@Param('id', ParseUUIDPipe) conversationId)
Returns: { messages: unknown[] }
```

**Service Method Called**: `LearningAgentService.getConversationMessages()`
```typescript
async getConversationMessages(conversationId: string): Promise<AiConversationMessage[]>
```

**Service Implementation Details**:
- Queries AiConversationMessage by conversationId
- Orders by createdAt ASC
- **Uses Entities**: AiConversationMessage
- **Uses Repositories**: AiConversationMessage repository
- **Dependencies**: None (only database operations)

**Database Dependency**:
- **Entity**: AiConversationMessage (ai_conversation_messages table)
- **Repository**: messageRepo: Repository<AiConversationMessage>

---

## 2. ENDPOINTS TO KEEP (Shared Functionality)

### Endpoint: POST /ai/chat

**Service Method**: `LearningAgentService.chat()`
```typescript
async chat(
  userId: string,
  message: string,
  context: ConversationContext,
  model?: LLMModel,
): Promise<{ message: string; conversationId: string }>
```

**Uses**:
- `promptLoader.loadPrompt('tutor-system-prompt')`
- `llmService.chat()`
- `getConversationHistory()` (calls messageRepo)
- `saveMessage()` (calls messageRepo)
- Repositories: AiConversation, AiConversationMessage

---

### Endpoint: POST /ai/chat/stream

**Service Method**: `LearningAgentService.streamChat()`
```typescript
async *streamChat(
  userId: string,
  message: string,
  context: ConversationContext,
  model?: LLMModel,
): AsyncIterable<string>
```

**Uses**: Same dependencies as `chat()`

---

### Endpoint: POST /ai/chat/correct

**Service Method**: `LearningAgentService.checkCorrection()`
```typescript
async checkCorrection(
  previousAiMessage: string,
  userMessage: string,
  targetLanguage: string,
): Promise<{ correctedText: string | null }>
```

**Uses**:
- `promptLoader.loadPrompt('correction-check-prompt')`
- `llmService.chat()` (with GPT-4o, temperature: 0, maxTokens: 200)

---

### Endpoint: POST /ai/translate

**Service Methods**:
1. `TranslationService.translateWord()`
2. `TranslationService.translateSentence()`

**Uses**:
- `promptLoader.loadPrompt('translate-word')` or `promptLoader.loadPrompt('translate-sentence')`
- `llmService.chat()` (with GPT-4-1-NANO)
- Repositories: Vocabulary, AiConversationMessage
- Entities: Vocabulary, AiConversationMessage

---

## 3. EXTERNAL DEPENDENCIES (Used by Kept Endpoints)

### Service Used by Onboarding Module
**Import**: `/Users/tienthanh/Documents/new_flowering/be_flowering/src/modules/onboarding/onboarding.service.ts`

**Uses from AI Module**:
- `UnifiedLLMService` - **CRITICAL, MUST KEEP**
- `PromptLoaderService` - **CRITICAL, MUST KEEP**
- Loads prompts: 'onboarding-chat-prompt', 'onboarding-extraction-prompt', 'onboarding-scenarios-prompt'

**Entities Used**: AiConversation, AiConversationMessage (same as chat endpoints)

**Impact**: Deleting UnifiedLLMService or PromptLoaderService will BREAK onboarding.

---

## 4. DETAILED DTOs

### To Delete (Delete-Only Endpoints)
1. `GenerateExerciseRequestDto` - /ai/exercises/generate
2. `ExerciseResult` - /ai/exercises/generate response
3. `PronunciationAssessmentRequestDto` - /ai/pronunciation/assess
4. `PronunciationResult` - /ai/pronunciation/assess response
5. `PronunciationError` - Part of PronunciationResult
6. `CreateConversationDto` - /ai/conversations

### To Keep (Used by Other Endpoints)
1. `ChatRequestDto` - POST /ai/chat
2. `ChatResponseDto` - POST /ai/chat response
3. `ConversationContext` - Part of ChatRequestDto
4. `CorrectionCheckRequestDto` - POST /ai/chat/correct
5. `CorrectionCheckResponseDto` - POST /ai/chat/correct response
6. `TranslateRequestDto` - POST /ai/translate
7. `TranslateType` enum - POST /ai/translate

---

## 5. SERVICE METHODS - SAFE TO DELETE

All methods from `LearningAgentService`:
- ❌ `generateExercise()` - Only used by DELETE endpoint
- ❌ `assessPronunciation()` - Only used by DELETE endpoint
- ❌ `createConversation()` - Only used by DELETE endpoint
- ❌ `getConversationMessages()` - Only used by DELETE endpoint
- ✅ `chat()` - KEEP
- ✅ `streamChat()` - KEEP
- ✅ `checkCorrection()` - KEEP
- ✅ `getConversationHistory()` - KEEP (used by chat/streamChat)
- ✅ `saveMessage()` - KEEP (used by chat/streamChat)

All methods from `TranslationService`:
- ✅ `translateWord()` - KEEP
- ✅ `translateSentence()` - KEEP

---

## 6. SERVICE METHODS - MUST KEEP

**UnifiedLLMService**: All methods (used by onboarding + kept endpoints)
- `chat()`
- `stream()`

**PromptLoaderService**: All methods (used by onboarding + kept endpoints)
- `loadPrompt()`
- `clearCache()`

**WhisperTranscriptionService**: Only `transcribe()` (DELETE with endpoint)

---

## 7. PROMPT FILES

### To Delete (Only for Delete-Safe Endpoints)
- `exercise-generator-prompt.md` - /ai/exercises/generate
- `pronunciation-assessment-prompt.md` - /ai/pronunciation/assess

### To Keep
- `tutor-system-prompt.md` - chat endpoint
- `correction-check-prompt.md` - chat/correct endpoint
- `translate-word.md` - translate endpoint
- `translate-sentence.md` - translate endpoint
- `onboarding-chat-prompt.md` - **onboarding module (CRITICAL)**
- `onboarding-extraction-prompt.md` - **onboarding module (CRITICAL)**
- `onboarding-scenarios-prompt.md` - **onboarding module (CRITICAL)**

---

## 8. REPOSITORY/ENTITY USAGE

### AiConversation Entity
- Used by:
  - `createConversation()` - DELETE endpoint (but entity needs to stay for conversation history)
  - `chat()` / `streamChat()` - KEEP endpoint (updates messageCount)
  - Onboarding module - CRITICAL
- Status: **MUST KEEP** (too many dependencies)

### AiConversationMessage Entity
- Used by:
  - `getConversationMessages()` - DELETE endpoint
  - `getConversationHistory()` - KEEP endpoint (reads messages)
  - `chat()` / `streamChat()` - KEEP endpoint (saves messages)
  - `translateSentence()` - KEEP endpoint (reads/updates translatedContent)
  - Onboarding module - CRITICAL
- Status: **MUST KEEP** (too many dependencies)

### Vocabulary Entity
- Used by:
  - `translateWord()` - KEEP endpoint (upserts vocabulary)
- Used by: DELETE endpoints? NO
- Status: **KEEP** (only for translate endpoint, not delete endpoints)

---

## 9. PROVIDER/LLM USAGE

### OpenAILLMProvider
- Used by UnifiedLLMService (MUST KEEP)
- Models used:
  - GPT-4o (checkCorrection)
  - GPT-4-1-NANO (translate endpoints)
  - Others in defaults
- Status: **MUST KEEP**

### GeminiLLMProvider
- Used by UnifiedLLMService (MUST KEEP)
- Used in: chat, generateExercise, assessPronunciation (default model)
- Status: **MUST KEEP**

### AnthropicLLMProvider
- Used by UnifiedLLMService (MUST KEEP)
- Status: **MUST KEEP**

---

## 10. TEST FILES

### Test Files to Delete
- `/src/modules/ai/services/learning-agent-correction.service.spec.ts`
  - Tests `LearningAgentService.checkCorrection()` 
  - **WAIT**: This method is KEPT (used by POST /ai/chat/correct)
  - Status: **DO NOT DELETE** (test for kept endpoint)

- `/src/modules/ai/services/translation.service.spec.ts`
  - Tests `TranslationService` methods
  - Both `translateWord()` and `translateSentence()` are KEPT
  - Status: **DO NOT DELETE** (tests for kept endpoint)

---

## 11. DELETION CHECKLIST

### Files to Delete
```
/src/modules/ai/dto/generate-exercise.dto.ts
/src/modules/ai/dto/pronunciation-assessment.dto.ts
/src/modules/ai/dto/create-conversation.dto.ts (if separate)
/src/modules/ai/prompts/exercise-generator-prompt.md
/src/modules/ai/prompts/pronunciation-assessment-prompt.md
/src/modules/ai/services/whisper-transcription.service.ts
```

### Code to Remove from LearningAgentService
- Method: `generateExercise()` (lines 165-191)
- Method: `assessPronunciation()` (lines 196-218)
- Method: `createConversation()` (lines 40-49)
- Method: `getConversationMessages()` (lines 238-243)
- Import: Remove `WhisperTranscriptionService` from constructor

### Code to Remove from AiController
- Method: `generateExercise()` (lines 111-122)
- Method: `assessPronunciation()` (lines 124-167)
- Method: `createConversation()` (lines 195-203)
- Method: `getConversationMessages()` (lines 205-212)
- Imports: Remove `WhisperTranscriptionService`, `FileInterceptor`, unused DTOs

### Code to Remove from ai.module.ts
- Remove: `WhisperTranscriptionService` from providers list

### DTOs to Remove from dto/index.ts
- Remove: `export * from './generate-exercise.dto'`
- Remove: `export * from './pronunciation-assessment.dto'`
- Keep other exports

### AI Module Exports (ai.module.ts line 64)
- Current exports: `UnifiedLLMService, LearningAgentService, PromptLoaderService`
- After deletion: Could optionally remove `LearningAgentService` if not used elsewhere (onboarding doesn't import it directly)
- Check: Onboarding uses UnifiedLLMService and PromptLoaderService only (not LearningAgentService)
- **Recommendation**: Remove LearningAgentService from exports after cleanup

---

## 12. SHARED DEPENDENCIES SUMMARY

### CANNOT DELETE (Used by Kept Endpoints OR Onboarding)
```
✅ UnifiedLLMService - CRITICAL (chat, translate, onboarding)
✅ PromptLoaderService - CRITICAL (chat, translate, correction, onboarding)
✅ LearningAgentService - USED BY KEPT ENDPOINTS (chat, streamChat, checkCorrection)
✅ TranslationService - USED BY KEPT ENDPOINT (translate)
✅ OpenAILLMProvider - CRITICAL (all LLM operations)
✅ GeminiLLMProvider - CRITICAL (all LLM operations)
✅ AnthropicLLMProvider - CRITICAL (all LLM operations)
✅ AiConversation entity - CRITICAL (conversation storage, onboarding)
✅ AiConversationMessage entity - CRITICAL (message history, translation caching, onboarding)
✅ Vocabulary entity - USED (translate endpoint)
```

### CAN DELETE (Only for Delete Endpoints)
```
❌ WhisperTranscriptionService - ONLY for /ai/pronunciation/assess
❌ GenerateExerciseRequestDto, ExerciseResult - ONLY for /ai/exercises/generate
❌ PronunciationAssessmentRequestDto, PronunciationResult - ONLY for /ai/pronunciation/assess
❌ CreateConversationDto - ONLY for /ai/conversations
```

---

## 13. UNRESOLVED QUESTIONS

1. Is `getConversationHistory()` and `saveMessage()` used only internally in LearningAgentService?
   - Yes, they are private helper methods. Safe to keep with the service.

2. Are there any HTTP clients or tests that call these 4 delete endpoints?
   - Need to check: Integration tests, E2E tests, API documentation examples
   
3. Should `LearningAgentService` be exported from ai.module.ts after cleanup?
   - Currently exported but only used within the module
   - Recommend: Remove from exports if not used elsewhere

4. Are there any scheduled jobs or async workers that call these endpoints?
   - Need to check: Cron jobs, message queues, background tasks

5. Does the frontend have code referencing these endpoints?
   - Not part of this backend analysis, but important for frontend cleanup
