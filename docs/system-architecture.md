# System Architecture

**Last Updated:** 2026-05-11

## Architecture Overview

AI-powered language learning backend following Clean Architecture principles with NestJS framework. Modular design with 13 feature modules and clear separation of concerns. Implements language partitioning strategy for multi-language content isolation.

## Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│                  Presentation Layer                      │
│  (Controllers, DTOs, Guards, Interceptors, Decorators)  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   Application Layer                      │
│       (Services, Business Logic, Use Cases)             │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                    Domain Layer                          │
│         (Entities, Domain Models, Enums)                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                 Infrastructure Layer                     │
│  (Database, External APIs, RevenueCat, AI, Langfuse)   │
└─────────────────────────────────────────────────────────┘
```

## Core Architecture Patterns

### 1. Modular Architecture
13 feature modules with NestJS DI; each self-contained. **Critical:** Register all entities in BOTH:
1. `database.module.ts` (global entities array)
2. Feature module's `TypeOrmModule.forFeature([...])` (@InjectRepository)

### 2. Design Patterns
- **DI:** NestJS IoC manages all dependencies
- **Repository:** TypeORM abstracts DB operations
- **Strategy:** AI module multi-provider (OpenAI, Anthropic, Google)
- **Factory:** Provider selection per request

## Module Architecture Details

### Authentication Module Flow
```
┌──────────────────────────────────────────────────────┐
│           Auth Controller                            │
│  POST /auth/register, /login, /firebase             │
│  POST /auth/refresh, /logout                         │
│  POST /auth/forgot-password, /verify-otp, /reset... │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│           Auth Service                               │
│  - validateUser()                                   │
│  - createUser()                                     │
│  - generateJWT()                                    │
│  - firebaseLogin() (Google & Apple unified)         │
│  - processPasswordReset()                           │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│        Firebase Admin & Passport Strategies         │
│  - FirebaseAdminService (token verification)        │
│  - JwtStrategy (JWT validation)                     │
│  - FirebaseTokenStrategy (Firebase token validation)│
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│           Database Layer                             │
│  UserRepository → PostgreSQL (Railway)              │
│  PasswordResetRepository → PostgreSQL               │
└──────────────────────────────────────────────────────┘
```

**Key Features:** Sole method: `POST /auth/firebase` (auto-detects Google/Apple). Composite refresh tokens (uuid:hex, 90d expiry). OAuth auto-links existing emails. Email/password disabled (410 Gone). Firebase gracefully degrades on init failure.

### AI Module Flow
```
┌──────────────────────────────────────────────────────┐
│           AI Controller                              │
│  POST /ai/chat, /chat/correct, /translate           │
│  POST /ai/transcribe (audio to text)                │
│  SSE /ai/chat/stream                               │
└──────────────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────────────────────────┐
│  Learning Agent  │  Translation Service  │  Transcription Svc  │
│  - processChat() │  - translateWord()    │  - transcribe()     │
│  - checkCorrect()│  - translateSentence()│  - validateFile()   │
│                 │  - upsertVocab()      │  - selectProvider() │
└────────────────────────────────────────────────────────────────┘
                    ↓
        ┌───────────┴────────────────────────────────┐
        ↓                                            ↓
┌──────────────────────────────┐      ┌──────────────────────┐
│  Unified LLM Service          │      │  Transcription Service    │
│  - selectProvider()           │      │  (STT with Signed URLs)   │
│  - callLLM()                  │      │  - validateFile()          │
│  - handleFallback()           │      │  - uploadAudio() → bucket  │
│  LLM Providers:               │      │  - transcribe()            │
│  ├─ OpenAI (3 models)         │      │  - generateSignedUrl(1h)   │
│  ├─ Anthropic (2 models)      │      └────────────────────────────┘
│  └─ Google AI (3 models)      │             ↓
└──────────────────────────────┘      STT Providers:
        ↓                             ├─ OpenAI Whisper (primary)
┌──────────────────────────────┐      └─ Gemini Multimodal (fallback)
│   Langfuse Tracing           │             ↓
│ (per-invocation handlers)    │      Railway Private Bucket
│   await handler.flushAsync() │      (Presigned URLs for mobile)
└──────────────────────────────┘
        ↓
┌──────────────────────────────┐
│  Database Operations         │
│  - AiConversationMessage     │
│  - Vocabulary (translations) │
│  - Message translation cache │
└──────────────────────────────┘
```

**Translation:** Word (LLM → Vocabulary) | Sentence (fetch & cache). Model: GPT4-1-NANO (temp 0.1)

**Correction:** Input: prev AI msg + user msg + lang. Output: correctedText (null if no errors). Public endpoint, optional premium. Model: GPT4-1-NANO (temp 0.3)

**STT:** POST /ai/transcribe (premium). Input: M4A/MP4/MPEG/WAV (max 10MB). Providers: OpenAI Whisper → Gemini (fallback). Config: STT_PROVIDER env var.

### Subscription Module Flow
```
┌──────────────────────────────────────────────────────┐
│    Subscription Controller & Webhook Controller      │
│  GET /subscriptions/me                              │
│  POST /webhooks/revenuecat (public, bearer auth)   │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│        Subscription Service                          │
│  - getUserSubscription()                            │
│  - processWebhook()                                 │
│  - updateSubscriptionStatus()                       │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┘
│        Webhook Processing Flow (Idempotent):         │
│  1. Validate Bearer token (timing-safe)             │
│  2. Reject if NODE_ENV=production and sandbox event │
│  3. Check WebhookEvent table for eventId            │
│  4. Process synchronously (RC retries on failure)  │
│  5. Insert into WebhookEvent (acts as lock)         │
│  6. Update subscription status in DB                │
│  7. Return 200 after processing; errors return 5xx  │
└──────────────────────────────────────────────────────┘
```

### Email Module Flow
```
┌──────────────────────────────────────────────────────┐
│      Email Service (Internal, No Controller)         │
│  - Nodemailer SMTP configuration                    │
│  - Graceful initialization with try-catch          │
│  - Status flag: initialized                         │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│      Email Service Methods                           │
│  - sendPasswordResetEmail(email, token)             │
│  - sendOtpEmail(email, otp)                         │
│  - sendNotificationEmail(email, content)            │
└──────────────────────────────────────────────────────┘
                    ↓
        [Service initialized?]
        ↙              ↖
     Yes            No (graceful degrade)
      ↓                    ↓
   Send via          Return error
   Nodemailer        to caller
   (configured       (endpoints
   via env vars)     return proper
                     error response)
```

**Configuration:** Loaded from env vars (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS). **Graceful Init:** Constructor wraps Nodemailer initialization in try-catch; sets `initialized = false` on failure. **Error Handling:** Callers check `initialized` flag before sending; return 500 if unavailable.

### Progress Module Flow
```
┌──────────────────────────────────────────────────────┐
│      Progress Service (Internal, No Controller)      │
│  - upsertProgress(userId, languageId, data)        │
│  - recordAttempt(userId, exerciseId, data)         │
│  - getProgressByLanguage(userId, languageId)       │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│      Progress Entities                               │
│  - UserProgress (total XP, streak, levels per lang) │
│  - UserExerciseAttempt (score, time, correctness)  │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│      Language-Scoped Operations                      │
│  - Progress tracked per (user, language) pair      │
│  - UserLanguage links user to enrolled languages   │
│  - No cross-language progress mixing               │
└──────────────────────────────────────────────────────┘
```

**Invariants:** Progress created on-demand (lazy); updated transactionally with exercise attempts. Language context guard enforces scope at request level.

### Onboarding Module Flow
```
┌──────────────────────────────────────────────────────┐
│      Onboarding Controller (No Auth Required)        │
│  POST /onboarding/chat (dual-purpose)              │
│  POST /onboarding/complete (idempotent)            │
│  GET /onboarding/conversations/:id/messages        │
└──────────────────────────────────────────────────────┘
                    ↓
        [Request contains conversationId?]
                 ↙              ↖
         No (New)            Yes (Resume)
         ↙                      ↖
   createSession()          processMessage()
   (turn 1 greeting)        (standard turn)
         ↓                      ↓
┌──────────────────────────────────────────────────────┐
│        Onboarding Service                            │
│  - createSession(native_lang, target_lang)         │
│  - processMessage(conv_id, message)                │
│  - complete(conv_id) — idempotent profile extract   │
│  - getMessages(conv_id) — fetch transcript          │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│        AI Learning Agent (for Onboarding)           │
│  - Session-based state management                   │
│  - Profile extraction (cached after first success)  │
│  - Scenario generation (cached after first success) │
│  - Max 10 turns per session                         │
└──────────────────────────────────────────────────────┘
```

**Rate Limiting (OnboardingThrottlerGuard):**
- New session (no `conversation_id`): 5 req/hr per IP
- Chat continuation (with `conversation_id`): 30 req/hr per IP
- Message fetch GET endpoint: 30 req/hr per IP

**First-Turn Detection:** Via `messageCount` on AiConversation (authoritative). **Caching:** /complete caches profile + scenarios (5 items, stable UUIDs); idempotent. **Resume:** GET messages fetches transcript for mobile rehydration.

### Lesson Module Flow
```
┌──────────────────────────────────────────────────────┐
│           Lesson Controller                          │
│  GET /lessons?language=uuid&level=beginner&search=.. │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│           Lesson Service                             │
│  - getLessons(userId, query)                        │
│  - buildVisibilityFilter()                          │
│  - computeScenarioStatus()                          │
│  - groupByCategoryAndPaginate()                     │
└──────────────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────────────────────┐
│     Repository Queries (TypeORM QueryBuilder)              │
│  - Scenario: visibility + difficulty + search filters     │
│  - UserScenarioAccess: user-granted scenarios             │
│  - Subscription: premium status for status computation    │
│  - UserProgress: (future) learned status tracking        │
└────────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│      Response Aggregation & Grouping                 │
│  - Group scenarios by ScenarioCategory              │
│  - Compute status per scenario                      │
│  - Apply pagination on total count                  │
│  - Return grouped response                          │
└──────────────────────────────────────────────────────┘
```

**Visibility:** (status = 'published') AND (language_id NULL OR matches context OR user_scenario_access). **Status:** learned / locked (premium, free user) / available.

### Scenario Module Flow (Dual Controllers)

**ScenariosController** (Listing & Detail):
```
┌──────────────────────────────────────────────────────┐
│    GET /scenarios (list all, default/personal/redeem)│
│    GET /scenarios/:id (detail with soft-lock state) │
│    POST /scenarios/redeem (gift code redeem, 5/min)  │
└──────────────────────────────────────────────────────┘
                    ↓
        [Query filters: default|personal|redeem]
                 ↓
┌──────────────────────────────────────────────────────┐
│    Scenarios Service                                 │
│  - getDefaultScenarios()                            │
│  - getPersonalScenarios()                           │
│  - getScenarioDetail() — soft-lock (no 403)        │
│  - redeemGiftCode() — grant access via KOL bundle  │
└──────────────────────────────────────────────────────┘
```

**ScenarioChatController** (Roleplay Conversations):
```
┌──────────────────────────────────────────────────────┐
│        POST /scenario/chat (roleplay turns)         │
│        GET /scenario/conversations/:id (transcript)  │
│        GET /scenario/:scenarioId/conversations      │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│        Scenario Chat Service                         │
│  - processChat(scenarioId, message?, convId?)       │
│  - validateScenarioAccess()                         │
│  - generateAIReply()                                │
│  - updateConversationState()                        │
│  - checkCompletionStatus() — max 12 turns          │
│  - getConversation(convId)                          │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│      Scenario Access Service                         │
│  - checkAccessTierAccess()                          │
│  - verifyScenarioExists()                           │
└──────────────────────────────────────────────────────┘
                    ↓
┌────────────────────────────────────────────────────────────────┐
│  LangChain AI Provider & Langfuse Tracing                      │
│  - Multi-provider LLM support (OpenAI, Anthropic, Gemini)     │
│  - Request tracing with prompt/response logging               │
└────────────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│      Database Operations                             │
│  - AiConversation (with scenarioId FK)              │
│  - AiConversationMessage (turn history)             │
│  - Subscription (active status check)               │
│  - Scenario (access_tier + content_status)          │
└──────────────────────────────────────────────────────┘
```

**Access:** Free users cannot access premium tier. Premium can access all. User-granted access (user_scenario_access) overrides tier.

**Turns:** First msg (no `message` param) → AI initiates. Subsequent → AI responds. Max turns reached → completed: true (immutable).

### Vocabulary & Leitner SRS Module Flow
```
┌──────────────────────────────────────────────────────────────────┐
│              Vocabulary CRUD Endpoints                            │
│  GET /vocabulary, GET /vocabulary/:id, DELETE /vocabulary/:id   │
└──────────────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────────────┐
│              Vocabulary Service                                  │
│  - list(userId, query)       → paginated list with filters      │
│  - findOne(userId, id)       → single item or 404               │
│  - remove(userId, id)        → delete and verify ownership      │
└──────────────────────────────────────────────────────────────────┘
                    ↓
        ┌───────────────────────────────────────────┐
        ↓                                           ↓
┌──────────────────────────────────────┐   ┌──────────────────────────┐
│   Review Session Endpoints:           │   │   Database:              │
│   POST /vocabulary/review/start       │   │   - Vocabulary table     │
│   POST /vocabulary/review/:id/rate    │   │     (box, due_at, etc.)  │
│   POST /vocabulary/review/:id/complete│   │   - Index: user_id,      │
│                                       │   │     due_at               │
└──────────────────────────────────────┘   └──────────────────────────┘
        ↓                                           ↑
┌──────────────────────────────────────────────────────────────────┐
│       Vocabulary Review Service                                  │
│  - startSession(userId, query)                                   │
│    → Query due cards WHERE due_at <= NOW()                       │
│    → Create in-memory session (1h TTL)                           │
│    → Return cards + session_id                                   │
│                                                                  │
│  - rateCard(sessionId, vocabId, correct)                         │
│    → Verify card in session, not yet rated                       │
│    → Apply Leitner transition (see table below)                  │
│    → Update vocabulary.box, vocabulary.due_at                    │
│    → Update vocabulary.last_reviewed_at, review_count, correct   │
│    → Return updated box & new due_at                             │
│                                                                  │
│  - completeSession(sessionId)                                    │
│    → Verify session exists                                       │
│    → Compute stats (total, correct, wrong, accuracy)             │
│    → Group final boxes for distribution                          │
│    → Delete session from store                                   │
│    → Return stats + box_distribution                             │
└──────────────────────────────────────────────────────────────────┘
        ↓
┌──────────────────────────────────────────────────────────────────┐
│       Review Session Store (In-Memory)                           │
│  - Key: session UUID                                             │
│  - Value: {userId, cardIds[], ratings: {cardId: bool}}           │
│  - TTL: 1 hour (auto-eviction)                                   │
│  - Cleanup: 5-minute sweep for expired sessions                  │
└──────────────────────────────────────────────────────────────────┘
```

**Leitner:** Box 1→2 (+3d), 2→3 (+7d), 3→4 (+14d), 4→5 (+30d), 5→5 (+30d). Wrong: any→1 (+1d).

**Invariants:** Card cannot re-rate in same session. Session expiry doesn't delete vocab. dueAt query: `<= NOW()`. reviewCount increments always; correctCount only on correct.

**Language Context Flow:** Guard extracts X-Learning-Language header → LRU cache (60s TTL) → store in req.activeLanguage → services filter by language_id. **Invariants:** All content routes require context. Missing/invalid header → 400.

### Admin Content Module Flow
```
┌──────────────────────────────────────────────────────────┐
│    Admin Content Controller                              │
│    POST /admin/content/generate                         │
│    GET /admin/content                                   │
│    PATCH /admin/content/:id/publish                     │
│    PATCH /admin/content/:id                             │
│    DELETE /admin/content/:id                            │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│    AdminGuard: Check user.isAdmin flag                  │
│    (bootstrapped via ADMIN_EMAILS env var)              │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│    Admin Content Service                                 │
│    - generateDrafts(adminId, dto)                       │
│    - listContent(query filters)                         │
│    - publishContent(id, type)                           │
│    - updateContent(id, type, updates)                   │
│    - archiveContent(id, type)                           │
└──────────────────────────────────────────────────────────┘
                    ↓
        [For generateDrafts]
                 ↓
┌──────────────────────────────────────────────────────────┐
│    Unified LLM Service (LangChain)                       │
│    - Generate structured content in JSON                │
│    - Batch generation (count parameter)                 │
│    - LangFuse tracing per invocation                    │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│    Insert Lesson/Exercise/Scenario entities              │
│    - All content created with status=draft               │
│    - All content includes specified language_id          │
│    - All content initially hidden from users             │
└──────────────────────────────────────────────────────────┘
```

**Lifecycle:** draft → publish (visible) → archive (soft delete). **Rate Limit:** /generate 5 req/min (Throttle guard); others: none.

### KOL Bundle Module Flow
```
┌──────────────────────────────────────────────────────────┐
│    KOL Bundle Controller                                 │
│    POST /admin/kol-bundles                              │
│    GET /admin/kol-bundles                               │
│    POST /admin/kol-bundles/:id/scenarios                │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│    RolesGuard: Check 'admin' in user.roles               │
│    (bootstrapped via ADMIN_EMAILS env var)              │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│    KOL Bundle Service                                    │
│    - create(dto) — create bundle with scenarios          │
│    - list(query) — paginated bundle list                │
│    - attachScenarios(bundleId, dto) — add scenarios     │
└──────────────────────────────────────────────────────────┘
                    ↓
        ┌───────────────────────────────┐
        ↓                               ↓
┌──────────────────────────────┐  ┌──────────────────────────┐
│  KolBundle Entity            │  │  KolBundleScenario Table │
│  - gift_code (unique)        │  │  (join table)            │
│  - name, description         │  │  - Unique(bundle,        │
│  - is_active flag            │  │    scenario) for         │
│  - created/updated timestamps│  │    idempotent attach     │
└──────────────────────────────┘  └──────────────────────────┘
        ↓                               ↑
        └───────────────────────────────┘
```

**Redemption Flow (User):**
```
User POST /scenarios/redeem {gift_code}
        ↓
ScenariosRedeemService.redeem()
        ↓
Validate gift_code exists in KolBundle
        ↓
Query KolBundleScenario.scenarios via bundle_id
        ↓
For each scenario: upsert UserAiScenario
        (idempotent: duplicate codes safe)
        ↓
Return redeemed_count + scenario list
```

**Rate Limit:** None on bundle management. 5 req/min on redeem endpoint. **Idempotency:** Gift code uniqueness + UserAiScenario unique constraint ensure safe retries.

## Database Architecture

### Entity Relationships
```
User (1) ──< (N) UserLanguage
User (1) ──< (1) Subscription
User (1) ──< (N) AiConversation
User (1) ──< (N) RefreshToken
User (1) ──< (N) PasswordReset
User (1) ──< (N) Vocabulary
User (1) ──< (N) UserScenarioAccess
User (1) ──< (N) UserAiScenario  (personal scenarios: AI-generated or KOL-granted)
User (1) ──< (N) UserProgress
User (1) ──< (N) UserExerciseAttempt

Language (1) ──< (N) UserLanguage
Language (1) ──< (N) Lesson  (non-nullable, language partitioning key)
Language (1) ──< (N) Exercise  (non-nullable, language partitioning key)
Language (1) ──< (N) Scenario  (non-nullable, language partitioning key)
Language (1) ──< (N) UserProgress  (non-nullable, language partitioning key)
Language (1) ──< (N) UserExerciseAttempt  (non-nullable, language partitioning key)

ScenarioCategory (1) ──< (N) Scenario
Scenario (1) ──< (N) UserScenarioAccess
Scenario (1) ──< (N) UserAiScenario  (links to user's personal scenarios)
Scenario (1) ──< (N) KolBundleScenario  (links to KOL bundle distribution)
Scenario (1) ──< (N) AiConversation  (for scenario chat)
User (1) ──< (N) Scenario  (as creator, nullable)

KolBundle (1) ──< (N) KolBundleScenario  (gift code distribution)

Lesson (1) ──< (N) Exercise
Exercise (1) ──< (N) UserExerciseAttempt

AiConversation (1) ──< (N) AiConversationMessage
```

**Vocabulary Entity:**
- Unique constraint: (userId, word, sourceLang, targetLang)
- Fields: word, translation, sourceLang, targetLang, partOfSpeech, pronunciation, definition, examples (JSONB)
- Purpose: Persist user's translated words for recall/learning
- Created by: TranslationService on word translation endpoint

### Technology Stack
- **Database:** PostgreSQL 18 (Railway)
- **Features:** timestamptz columns, UUID PKs, CASCADE deletion, indexed columns
- **Connection:** TypeORM connection pool with auto-reconnect
- **Object Storage:** S3-compatible bucket (Railway) via AWS SDK

## Multi-Language Content Architecture

### Language Partitioning Strategy

All content entities (Lesson, Exercise, Scenario, etc.) implement language partitioning via non-nullable `language_id` foreign key. This ensures each content row belongs to exactly one language, enabling:

1. **Request-Scoped Language Context:** Every authenticated request includes `X-Learning-Language: <code>` header specifying user's active learning language
2. **Automatic Content Filtering:** Service methods automatically scope queries by the active language context
3. **Cache-Efficient Resolution:** Language code → Language.id resolved once per request and cached (LRU, 60s TTL)
4. **Isolation by Design:** No global/NULL language rows; content is never ambiguous

### Language Context Resolution Flow

```
HTTP Request
    ↓
[LanguageContextGuard]
    ↓
Extract X-Learning-Language header
    ↓
Check LRU cache for language_code → {id, code}
    ↓
Cache hit? Return cached context
    ↓
Cache miss? Query Language table, cache result
    ↓
Store {id, code} in req.activeLanguage
    ↓
@ActiveLanguage() decorator injects language context into controller methods
    ↓
Service methods filter results by language_id
```

### Content Visibility with Language Partitioning

When user requests lessons/scenarios with active language = "es":

```
1. Service receives @ActiveLanguage() context: {id: "lang-uuid-es", code: "es"}
2. Query builder filters: WHERE language_id = "lang-uuid-es"
3. Only Spanish-language content returned
4. No cross-language data exposure
5. User content filtered consistently across all endpoints
```

### @SkipLanguageContext() Routes

Routes that bypass language context requirement (don't return partitioned content):

| Endpoint | Reason |
|----------|--------|
| POST /auth/* | Authentication, no content |
| GET /users/me | User profile, global |
| PATCH /users/me | User profile update, global |
| GET /languages | Language catalog, global |
| POST /languages/user | User preferences, global |
| GET /subscriptions/me | User subscription, global |
| POST /admin/content/* | Admin operations, cross-language |
| GET /admin/content | Admin operations, cross-language |
| POST /onboarding/chat | Anonymous sessions, no auth context |

### Admin Content Module Integration

Admin endpoints allow admins to:
1. Generate content for specific languages via `language_id` parameter
2. List content across languages with language filter
3. Publish/archive content per language

All generated content includes the specified `language_id`, ensuring proper partitioning.

## Multi-Language Content Architecture

### Language Partitioning Strategy

All content entities (Lesson, Exercise, Scenario, etc.) implement language partitioning via non-nullable `language_id` foreign key. This ensures each content row belongs to exactly one language, enabling:

1. **Request-Scoped Language Context:** Every authenticated request includes `X-Learning-Language: <code>` header specifying user's active learning language
2. **Automatic Content Filtering:** Service methods automatically scope queries by the active language context
3. **Cache-Efficient Resolution:** Language code → Language.id resolved once per request and cached (LRU, 60s TTL)
4. **Isolation by Design:** No global/NULL language rows; content is never ambiguous

### Language Context Resolution Flow

```
HTTP Request
    ↓
[LanguageContextGuard]
    ↓
Extract X-Learning-Language header
    ↓
Check LRU cache for language_code → {id, code}
    ↓
Cache hit? Return cached context
    ↓
Cache miss? Query Language table, cache result
    ↓
Store {id, code} in req.activeLanguage
    ↓
@ActiveLanguage() decorator injects language context into controller methods
    ↓
Service methods filter results by language_id
```

### Content Visibility with Language Partitioning

When user requests lessons/scenarios with active language = "es":

```
1. Service receives @ActiveLanguage() context: {id: "lang-uuid-es", code: "es"}
2. Query builder filters: WHERE language_id = "lang-uuid-es"
3. Only Spanish-language content returned
4. No cross-language data exposure
5. User content filtered consistently across all endpoints
```

### @SkipLanguageContext() Routes

Routes that bypass language context requirement (don't return partitioned content):

| Endpoint | Reason |
|----------|--------|
| POST /auth/* | Authentication, no content |
| GET /users/me | User profile, global |
| PATCH /users/me | User profile update, global |
| GET /languages | Language catalog, global |
| POST /languages/user | User preferences, global |
| GET /subscriptions/me | User subscription, global |
| POST /admin/content/* | Admin operations, cross-language |
| GET /admin/content | Admin operations, cross-language |
| POST /onboarding/chat | Anonymous sessions, no auth context |

### Admin Content Module Integration

Admin endpoints allow admins to:
1. Generate content for specific languages via `language_id` parameter
2. List content across languages with language filter
3. Publish/archive content per language

All generated content includes the specified `language_id`, ensuring proper partitioning.

## Security Architecture

**Firebase Flow:** Client obtains token (Google/Apple) → POST /auth/firebase → verify token → extract email/profile → check exists → auto-link or create → return JWT + refresh token.

**Role-Based Access Control (RBAC):** RolesGuard checks `user.roles` array (replaces AdminGuard). Decorator: `@Roles('admin')`. Default: ['user']. Admin users: ['user', 'admin'] seeded via ADMIN_EMAILS env var.

**Password Reset (Disabled):** Endpoints return 410 Gone; code preserved for future migration.

**Webhook Security:** Bearer token (timing-safe) validation → DTO schema → respond <60s → async process via setImmediate → update DB → log errors.

### Database Security
- Row-Level Security (RLS) on all tables
- Service role key for backend operations
- User data isolated via user_id FK
- CASCADE deletion on user removal

## External Integrations

| Service | Purpose | Auth | Features |
|---------|---------|------|----------|
| **Railway** | PostgreSQL + S3-compatible storage | DATABASE_URL, AWS keys | Database (PG18), object storage (signed URLs) |
| **RevenueCat** | Subscription management | Bearer token | Webhook events, status checks |
| **Firebase** | Push notifications | Service account JSON | FCM, multi-device support |
| **OpenAI** | GPT models | API key | GPT-4o, GPT-4o-mini |
| **Anthropic** | Claude models | API key | Claude 3.5 Sonnet, Haiku |
| **Google AI** | Gemini models | API key | Gemini 2.5 Flash, 1.5 Pro |
| **9router** | OpenAI-compatible AI gateway ("one key, many providers") | Bearer token (`NINEROUTER_KEY`) + `NINEROUTER_URL` | Server-side model aliases (e.g. `flowering_chat`); used by scenario roleplay chat, anonymous onboarding chat turns, and sentence translation — each with a Gemini fallback if 9router is unavailable |
| **Langfuse** | AI observability | Public/secret keys | Request tracing, analytics |
| **Sentry** | Error tracking | DSN | 5xx exception tracking, traces |

## Global Infrastructure

### Middleware & Guard Stack
1. **ValidationPipe:** Auto-transform DTOs, whitelist unknown properties
2. **ResponseTransformInterceptor:** Wrap all responses in `{code: 1, message, data}` format
3. **AllExceptionsFilter:** Global exception handler, Sentry integration for 5xx
4. **HttpLoggerMiddleware:** Log incoming requests and outgoing responses
5. **JwtAuthGuard:** Global protect endpoints (bypass with @Public())
6. **PremiumGuard:** Feature-level check for active subscription (use with @RequirePremium() on AI endpoints)
7. **CORS:** Configured via CORS_ALLOWED_ORIGINS

### Premium Feature Access
AI endpoints use two-tier protection:
1. **JwtAuthGuard (global):** Ensures user is authenticated
2. **PremiumGuard (feature-level):** Verifies subscription.isActive == true
3. **Decorator:** `@RequirePremium()` marks endpoint as premium-only
4. **Error:** Returns 403 Forbidden if subscription inactive

### Response Format
All responses follow consistent format:
```json
{
  "code": 1,
  "message": "Success message",
  "data": {...}
}
```

### Error Format
```json
{
  "code": 0,
  "message": "Error description",
  "data": null
}
```

### JSON Key Naming Convention
All HTTP API JSON keys (request body params and response data fields) use `snake_case`:
- Example: `user_id`, `access_token`, `created_at`, `session_id`, `language_id`
- Exception: Wrapper keys `code`, `message`, `data` remain unchanged (single-word, no transformation)
- Internal TypeScript code remains `camelCase` — the naming convention only applies to JSON serialization/deserialization

This standardization ensures consistent mobile app development experience across all API endpoints.

## Scalability Considerations

### Current Architecture
- **Horizontal Scaling:** Stateless NestJS application
- **Database:** Managed PostgreSQL with connection pooling
- **Webhooks:** Async processing prevents blocking

### Future Enhancements
- **Caching Layer:** Redis for session data and frequent queries
- **Background Jobs:** Bull/BullMQ for async task processing
- **CDN:** Static asset delivery
- **Load Balancer:** Distribute traffic across instances
- **Database Read Replicas:** Separate read/write workloads
- **Message Queue:** RabbitMQ/SQS for event-driven architecture

## Monitoring & Observability

### Application Monitoring
- **Error Tracking:** Sentry for 5xx exceptions (configurable trace sample: 20% prod, 100% dev)
- **Logging:** NestJS Logger with contextual information
- **Health Checks:** `/health` endpoint (future)

### AI Monitoring
- **Request Tracing:** Langfuse for all AI provider requests with per-invocation handlers
  - Fresh CallbackHandler created per request (not shared)
  - Explicit await handler.flushAsync() in finally blocks ensures traces are sent
  - Applied to OpenAI, Anthropic, Gemini, and 9router providers
- **Usage Tracking:** Token consumption and cost analysis
- **Performance:** Response time and latency metrics

### Webhook Monitoring
- **Logging:** Detailed logs for all webhook events
- **Error Tracking:** Async processing errors logged separately
- **Validation:** DTO schema validation errors captured

### HTTP Logging
- **Middleware:** HttpLoggerMiddleware logs all requests/responses
- **Details:** Method, URL, status code, response time, payload

## Configuration Management

### Environment-Based Config
All configuration via ConfigModule with validation:
- Required variables throw errors on startup
- Type validation (string, number, boolean)
- Default values for optional variables
- Regex validation for secrets

### Configuration Access
```typescript
constructor(private configService: ConfigService) {}
const apiKey = this.configService.get<string>('openai.apiKey');
```

## Deployment Architecture

### Application Deployment
- **Platform:** Cloud hosting (Vercel, Railway, AWS)
- **Runtime:** Node.js 20+
- **Build:** TypeScript compiled to JavaScript
- **Environment:** Production environment variables

### Database Deployment
- **Provider:** Railway (managed PostgreSQL 18)
- **Migrations:** Automated via TypeORM CLI
- **Backups:** Automated daily backups (Railway-managed)

### Object Storage
- **Provider:** Railway S3-compatible bucket
- **Access:** AWS SDK v3 with presigned URLs (1h expiry)
- **Assets:** Static images (language flags, scenario art) served via `GET /assets/*path` endpoint

### CI/CD Pipeline (Future)
```
1. Code Push to Repository
   ↓
2. Run Linting & Tests
   ↓
3. Build TypeScript
   ↓
4. Run Database Migrations
   ↓
5. Deploy to Staging
   ↓
6. Run E2E Tests
   ↓
7. Deploy to Production
```

## API Design

### RESTful Conventions
- **GET:** Retrieve resources
- **POST:** Create resources or trigger actions
- **PATCH:** Partial update
- **DELETE:** Remove resources

### Response Wrapper
All responses wrapped in standard format:
- Success: `{code: 1, message: "...", data: {...}}`
- Error: `{code: 0, message: "...", data: null}`

### Error Handling
- Global exception filter catches all errors
- Never exposes raw exceptions to frontend
- Consistent error format with meaningful messages

**Tech Stack Justification:**
- **NestJS:** Enterprise DI + TypeScript
- **TypeORM:** TS-first ORM, migrations, Repository pattern
- **Railway PostgreSQL:** Managed DB + easy scaling
- **Railway Storage:** S3-compatible, cost-effective, presigned URLs for security
- **RevenueCat:** Cross-platform subs + webhook-based
- **Firebase:** Industry FCM, reliable delivery
- **LangChain:** Multi-provider AI abstraction

**Constraints:** No distributed cache, no async jobs, REST-only, no real-time. **Trade-offs:** Monolith for speed, free tiers for cost, PostgreSQL for ACID.
