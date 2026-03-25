# AI Module Scout Report

**Date:** 2026-03-24  
**Branch:** fix/author-api-phase-correct  
**Status:** Current state analysis complete

---

## Executive Summary

The AI module (`src/modules/ai/`) is a mature, multi-provider LLM integration system with:
- 3 LLM providers (OpenAI, Anthropic, Gemini) via LangChain
- Langfuse tracing integration with recent flushAsync fixes
- 7 feature endpoints (chat, correction, exercises, pronunciation, translation)
- Onboarding integration for anonymous users
- Rate limiting & premium guard enforcement

**Active Branch Changes:** Fix applied to Langfuse service + all 3 LLM providers for per-call handler lifecycle management.

---

## 1. Services, Providers, Controllers

### Services (src/modules/ai/services/)

| File | Purpose | Key Methods |
|------|---------|-----------|
| **unified-llm.service.ts** | Router to correct LLM provider | `chat()`, `stream()` |
| **learning-agent.service.ts** | Main tutoring logic | `chat()`, `streamChat()`, `checkCorrection()`, `generateExercise()`, `assessPronunciation()`, conversation management |
| **translation.service.ts** | Word/sentence translation + vocabulary saving | `translateWord()`, `translateSentence()`, upsert to Vocabulary entity |
| **langfuse-tracing.service.ts** | Langfuse observability handler creation | `getHandler()`, `createUserHandler()` (with flushAt: 1) |
| **prompt-loader.service.ts** | Load & cache .md prompts with {{variable}} substitution | `loadPrompt()`, `clearCache()` |
| **whisper-transcription.service.ts** | Audio → text via OpenAI Whisper | `transcribe()` |

### LLM Providers (src/modules/ai/providers/)

| File | Provider | Supported Models | Key Implementation |
|------|----------|------------------|-------------------|
| **openai-llm.provider.ts** | OpenAI | gpt-4o, gpt-4o-mini, o1-preview, o1-mini, gpt-4.1-nano | Implements LLMProvider interface, per-call handler with flushAsync |
| **anthropic-llm.provider.ts** | Anthropic | claude-3-5-sonnet-20241022, claude-3-haiku-20240307 | Same pattern, maxTokens: 4096 default |
| **gemini-llm.provider.ts** | Google Gemini | gemini-2.5-flash-preview-05-20, gemini-2.0-flash, gemini-1.5-pro/flash | Uses ChatGoogleGenerativeAI |
| **llm-provider.interface.ts** | Interface | — | `chat()`, `stream()` contract |
| **llm-models.enum.ts** | Model enum + router | 10 models total | `getProviderFromModel()` routing logic |

### Controller (src/modules/ai/)

**ai.controller.ts**
- All endpoints require JWT (global guard) except `/chat/correct` and `/translate` (marked @Public)
- All require premium via `@RequirePremium()` except the public endpoints above
- Endpoints:
  - `POST /ai/chat` — Non-streaming chat
  - `SSE /ai/chat/stream` — Streaming via SSE
  - `POST /ai/chat/correct` — Grammar/vocab check (public, optional premium)
  - `POST /ai/exercises/generate` — Exercise generation
  - `POST /ai/pronunciation/assess` — Audio + text comparison
  - `POST /ai/translate` — Word or sentence translation (public, optional premium)
  - `POST /ai/conversations` — Create conversation session
  - `GET /ai/conversations/:id/messages` — Fetch message history

---

## 2. Correction Check Feature Flow

```
POST /ai/chat/correct
├─ Input: CorrectionCheckRequestDto
│  ├─ previousAiMessage (context)
│  ├─ userMessage (text to check)
│  └─ targetLanguage (language code)
│
├─ LearningAgentService.checkCorrection()
│  ├─ PromptLoaderService.loadPrompt('correction-check-prompt', variables)
│  ├─ UnifiedLLMService.chat([HumanMessage(prompt)])
│  │  └─ Model: OPENAI_GPT4_1_NANO, temperature: 0.3
│  └─ Parse response:
│     ├─ If "null" → return { correctedText: null }
│     ├─ Otherwise → return { correctedText: trimmed_response }
│
└─ Output: CorrectionCheckResponseDto
```

**Prompt:** `correction-check-prompt.md`
- Grammar fixer for {{targetLanguage}}
- Ignores punctuation & capitalization changes
- Returns `null` if no errors; otherwise corrected full sentence with **bold** grammar fixes
- No gibberish/emoji handling → returns `null`

**Recent Updates:**
- Commit 282adb9: Updated correction + onboarding prompts
- Commit bc3d82f: Simplified prompt, bold corrected words
- Commit 6806376: Skip punctuation/capitalization  
- Commit 7b05295: Enforce stricter grammar checking

**Test Coverage:** `learning-agent-correction.service.spec.ts` (11 test cases)
- Null handling, quote stripping, model/temp validation, empty string handling

---

## 3. Translation Feature Flow

```
POST /ai/translate (public endpoint)
├─ Input: TranslateRequestDto
│  ├─ type: "word" | "sentence"
│  ├─ text (for word) or messageId (for sentence)
│  ├─ sourceLang, targetLang
│  ├─ sessionToken (for anonymous) or JWT (for auth)
│
├─ TranslationService
│  ├─ For WORD:
│  │  ├─ PromptLoaderService.loadPrompt('translate-word')
│  │  ├─ LLM: OPENAI_GPT4_1_NANO, temperature: 0.1 (deterministic)
│  │  ├─ Parse JSON response (translation, partOfSpeech, pronunciation, definition, examples)
│  │  └─ If userId: upsert to Vocabulary entity
│  │     Else: return translation only (anonymous)
│  │
│  └─ For SENTENCE:
│     ├─ Find message by ID (verify ownership via userId || sessionToken)
│     ├─ Check cache (translatedContent if translatedLang matches)
│     ├─ PromptLoaderService.loadPrompt('translate-sentence')
│     ├─ LLM: OPENAI_GPT4_1_NANO, temperature: 0.1
│     └─ Save translation to message.translatedContent + translatedLang
│
└─ Output: WordTranslationResult | SentenceTranslationResult
```

**Prompts:**
- `translate-word.md` → JSON: {translation, partOfSpeech, pronunciation, definition, examples}
- `translate-sentence.md` → Plain text translation (no explanation)

**Vocabulary Storage:**
- Uses TypeORM `createQueryBuilder().insert().orUpdate()` for upsert
- Only for authenticated users (anonymous users get one-time translation only)
- Stores: userId, word, translation, sourceLang, targetLang, pronunciation, definition, examples

**Test Coverage:** `translation.service.spec.ts` (13 test cases)
- Auth/anon flows, vocabulary upsert, caching, ownership verification

---

## 4. Onboarding Module Interaction

**Location:** `src/modules/onboarding/` (separate module, imports AiModule)

**Flow:**
```
POST /onboarding/start
├─ Create anonymous CONVERSATION session (sessionToken)
└─ Return: { sessionToken, conversationId }

POST /onboarding/chat
├─ OnboardingService.chat(sessionToken, message)
├─ PromptLoaderService.loadPrompt('onboarding-chat-prompt')
│  └─ Variables: nativeLanguage, targetLanguage, currentTurn, maxTurns
├─ Get conversation history (last 20 messages)
├─ UnifiedLLMService.chat() [model: config.llmModel]
├─ Save user & AI message to conversation
└─ Return: { reply, messageId, turnNumber, isLastTurn }

POST /onboarding/complete
├─ Get full conversation transcript
├─ PromptLoaderService.loadPrompt('onboarding-extraction-prompt')
├─ Extract structured profile (name, age, region, learningMotivation, suggestedProficiency)
├─ PromptLoaderService.loadPrompt('onboarding-scenarios-prompt')
├─ Generate 5 personalized learning scenarios
└─ Return: { ...profile, scenarios: [{ id, title, description, icon, accentColor }] }
```

**Prompts:**
- `onboarding-chat-prompt.md` — Warm, conversational (native language), collects: name, age, region, motivation
- `onboarding-extraction-prompt.md` — Extract structured JSON from transcript
- `onboarding-scenarios-prompt.md` — Generate 5 personalized scenario objects

**Integration:**
- OnboardingModule imports AiModule (exports UnifiedLLMService, PromptLoaderService)
- Anonymous conversations stored in AiConversation (type: ANONYMOUS, sessionToken, expiresAt)
- Max 10 turns per session (configurable in onboarding.config.ts)
- Session TTL: 7 days (default)

---

## 5. Langfuse Tracing Integration

### Recent Change (Uncommitted, fix/author-api-phase-correct branch)

**Problem:** Old design used single shared handler → traces for concurrent requests could interfere.

**Solution:** Fresh handler per invocation with explicit flushAt: 1.

**Changes in langfuse-tracing.service.ts:**
```diff
- Removed: OnModuleDestroy, single handler instance, lazy initialization
+ Added: Per-call handler creation with flushAt: 1, flushInterval: 1000

Methods:
- getHandler() → creates fresh CallbackHandler each call
- createUserHandler(userId, sessionId) → includes user context + flushAt: 1
```

**Changes in all 3 LLM providers:**
```diff
All follow same pattern:
- createModel(name, options, handler?) → accept optional handler param
- chat() & stream() methods:
  + Const handler = this.langfuseService.getHandler()
  + Pass handler to createModel()
  + Finally block: await handler.flushAsync()
```

**Configuration:**
- `flushAt: 1` — Send trace immediately after call
- `flushInterval: 1000` — Fallback flush interval
- Each handler is independent → no cross-request contamination
- Metadata includes: userId, feature name, conversationId, model, etc.

**Current Handler Usage:**
- Non-user: `getHandler()` (no userId/sessionId)
- With user: `createUserHandler(userId, sessionId)` (for onboarding, corrections, translations)
- All AI endpoints will benefit from per-call isolation

---

## 6. Prompt Files in prompts/ Directory

| Prompt File | Purpose | Variables | Output Format |
|-------------|---------|-----------|----------------|
| **tutor-system-prompt.md** | System message for chat tutor | targetLanguage, nativeLanguage, proficiencyLevel, lessonTopic | Plain text instructions |
| **correction-check-prompt.md** | Grammar checker | previousAiMessage, userMessage, targetLanguage | `null` or corrected sentence with **bold** fixes |
| **exercise-generator-prompt.md** | Generate practice exercise | exerciseType, targetLanguage, proficiencyLevel, topic | JSON: {type, question, options[], correctAnswer, explanation, hints[]} |
| **pronunciation-assessment-prompt.md** | Assess audio accuracy | expectedText, transcribedText, targetLanguage | JSON: {score 0-100, feedback, errors[{word, issue, suggestion}]} |
| **translate-word.md** | Translate single word | word, sourceLang, targetLang | JSON: {translation, partOfSpeech, pronunciation, definition, examples[]} |
| **translate-sentence.md** | Translate sentence | sentence, sourceLang, targetLang | Plain text translation only |
| **onboarding-chat-prompt.md** | Collect user info | nativeLanguage, targetLanguage, currentTurn, maxTurns | Conversational reply (warm, natural) |
| **onboarding-extraction-prompt.md** | Extract profile from transcript | transcript | JSON: {name, age, region, learningMotivation, suggestedProficiency} |
| **onboarding-scenarios-prompt.md** | Generate 5 scenarios | nativeLanguage, targetLanguage, currentLevel, learningGoals, preferredTopics | JSON array of 5: [{title, description, icon, accentColor}] |

---

## 7. Module Architecture

### Dependency Graph

```
AiModule
├─ Providers: [OpenAI, Anthropic, Gemini, LangfuseService]
├─ Services: [UnifiedLLM, LearningAgent, Translation, PromptLoader, Whisper]
├─ Controller: [AiController]
├─ Entities: [AiConversation, AiConversationMessage, Vocabulary]
├─ Guards: [ThrottlerGuard (via ThrottlerModule), PremiumGuard]
└─ Exports: [UnifiedLLMService, LearningAgentService, PromptLoaderService]

OnboardingModule
├─ Imports: [AiModule, TypeOrmModule]
├─ Services: [OnboardingService]
├─ Controller: [OnboardingController]
└─ Entities: [AiConversation, AiConversationMessage (shared with AI)]
```

### Rate Limiting

- ThrottlerModule configured in AiModule:
  - `ai-short`: 20 req/min per user
  - `ai-medium`: 100 req/hour per user (free tier)
- Premium users get higher limits (managed via PremiumGuard)

### Authentication/Authorization

- All routes protected by global JWT guard
- Exceptions: `/chat/correct`, `/translate` marked `@Public()` (optional premium)
- `@RequirePremium()` decorator enforces subscription check
- Onboarding endpoints are public (anonymous sessions)

---

## 8. Key Files Summary

### Critical Files (Modified on fix/author-api-phase-correct)

1. **src/modules/ai/services/langfuse-tracing.service.ts**
   - Removed OnModuleDestroy pattern
   - Each call gets fresh handler with flushAt: 1
   - Support for per-user tracing context

2. **src/modules/ai/providers/openai-llm.provider.ts**
   - Handler passed to createModel()
   - Chat & stream both create handler, pass to model, flush in finally

3. **src/modules/ai/providers/anthropic-llm.provider.ts**
   - Identical pattern to OpenAI provider
   - Same flushAsync pattern in finally blocks

4. **src/modules/ai/providers/gemini-llm.provider.ts**
   - Same per-call handler approach
   - Uses ChatGoogleGenerativeAI from LangChain

### Test Files

- `learning-agent-correction.service.spec.ts` — 11 test cases for correction logic
- `translation.service.spec.ts` — 13 test cases for word/sentence translation

### Configuration Files

- `ai.module.ts` — Module registration, imports, exports
- `onboarding.config.ts` — Session TTL, max turns, LLM model, temperature defaults
- `llm-models.enum.ts` — All supported models + provider routing logic

---

## 9. Recent Commits (Last 20)

| Commit | Message | Impact |
|--------|---------|--------|
| 282adb9 | fix(ai): update correction and onboarding prompts | Prompt refinements |
| bf5373e | fix(ai): remove grammar check endpoint and related code | Removed old endpoint |
| bc3d82f | fix(ai): simplify correction prompt and bold corrected words | UX improvement |
| 6806376 | fix(ai): skip punctuation and capitalization in grammar correction | Focus on grammar only |
| 7b05295 | fix(ai): enforce stricter grammar checking in correction prompt | Stricter rules |
| 524ec93 | fix(ai): make translate endpoint publicly accessible and optional premium | Public endpoint |
| ebddef2 | fix(ai): make chat correction endpoint publicly accessible | Public endpoint |
| 52bc8cf | feat(subscription): implement webhook events, premium guard, and subscription sync | Premium guard added |
| 2c2fdf1 | feat(ai): implement correction check endpoint for grammar validation | Correction feature |
| 77c7925 | Merge PR #13 | Translation feature |

---

## 10. Current Branch Status (fix/author-api-phase-correct)

**Modified Files:**
- `src/modules/ai/services/langfuse-tracing.service.ts` (service lifecycle fix)
- `src/modules/ai/providers/openai-llm.provider.ts` (per-call handler pattern)
- `src/modules/ai/providers/anthropic-llm.provider.ts` (per-call handler pattern)
- `src/modules/ai/providers/gemini-llm.provider.ts` (per-call handler pattern)

**All changes:** Implement per-invocation Langfuse handler lifecycle to ensure:
1. Each LLM call gets isolated trace context
2. Concurrent requests don't interfere
3. Traces are flushed immediately (flushAt: 1)
4. User context preserved when available (createUserHandler)

---

## 11. Known Issues & Notes

- **No reported issues** in current state
- Correction prompt evolved through 5 commits (latest: simplified, punctuation-agnostic)
- Translation service handles both authenticated & anonymous users seamlessly
- Onboarding scenarios limited to hardcoded icons (briefcase, coffee, globe, etc.)
- All prompts support {{variable}} substitution via PromptLoaderService

---

## Summary Statistics

- **Total Services:** 6
- **LLM Providers:** 3 (OpenAI, Anthropic, Gemini)
- **API Endpoints:** 8 (6 AI + 2 conversation)
- **Public Endpoints:** 2 (`/chat/correct`, `/translate`)
- **Database Entities Used:** 3 (AiConversation, AiConversationMessage, Vocabulary)
- **Prompt Templates:** 9
- **Test Cases:** 24 (correction 11 + translation 13)
- **Rate Limit Rules:** 2 (per-minute, per-hour)

