# System Architecture

**Last Updated:** 2026-04-07

## Architecture Overview

AI-powered language learning backend following Clean Architecture principles with NestJS framework. Modular design with 7 feature modules and clear separation of concerns.

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
8 feature modules (auth, ai, user, language, subscription, onboarding, email, lesson) with dependencies injected via NestJS DI. Each module is self-contained with distinct responsibilities.

**Module Structure:**
```
module/
├── dto/                    # Data Transfer Objects
├── module.controller.ts    # HTTP endpoints
├── module.service.ts       # Business logic
├── module.module.ts        # NestJS module definition (with TypeOrmModule.forFeature())
└── [additional services]   # Feature-specific services
```

**Critical:** All entities must be registered in BOTH:
1. `database.module.ts` (global entities array for DataSource)
2. Feature module's `TypeOrmModule.forFeature([...])` (for @InjectRepository)

### 2. Dependency Injection
NestJS IoC container manages all dependencies for testability and loose coupling.

### 3. Repository Pattern
TypeORM provides repository abstraction for database operations.

### 4. Strategy Pattern
AI module uses strategy pattern for multi-provider support (OpenAI, Anthropic, Google AI).

### 5. Factory Pattern
AI client factory dynamically selects provider based on configuration.

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
│  UserRepository → PostgreSQL (Supabase)             │
│  PasswordResetRepository → PostgreSQL               │
└──────────────────────────────────────────────────────┘
```

**Key Features:**
- **Sole auth method: `POST /auth/firebase`** — accepts Firebase ID token; auto-detects Google or Apple provider
- Composite refresh tokens (uuid:hex) for O(1) validation
- OAuth auto-linking to existing email accounts (legacy password accounts are migrated on first OAuth sign-in matching the email)
- Provider-specific IDs prevent duplicates
- **Email/password endpoints disabled (410 Gone):** `/auth/register`, `/auth/login`, `/auth/forgot-password`, `/auth/verify-otp`, `/auth/reset-password` return HTTP 410. Service code and DB records preserved for future migration if needed.

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
│  Unified LLM Service          │      │  Transcription Svc   │
│  - selectProvider()           │      │  (STT)               │
│  - callLLM()                  │      │  - validateFile()    │
│  - handleFallback()           │      │  - uploadAudio()     │
│  LLM Providers:               │      │  - transcribe()      │
│  ├─ OpenAI (3 models)         │      └──────────────────────┘
│  ├─ Anthropic (2 models)      │             ↓
│  └─ Google AI (5 models)      │      STT Providers:
└──────────────────────────────┘      ├─ OpenAI Whisper (primary)
        ↓                             └─ Gemini Multimodal (fallback)
┌──────────────────────────────┐             ↓
│   Langfuse Observability     │      Supabase Storage
│   - Trace AI requests        │      (Audio persistence)
│   - Log prompts & responses  │
│   - Track usage metrics      │
└──────────────────────────────┘
        ↓
┌──────────────────────────────┐
│  Database Operations         │
│  - AiConversationMessage     │
│  - Vocabulary (translations) │
│  - Message translation cache │
└──────────────────────────────┘
```

**AI Provider Selection:** Load balancing with fallback, cost optimization per request type

**Translation Service:**
- Word translation: LLM call → save to Vocabulary entity for user recall
- Sentence translation: Fetch AiConversationMessage by ID → cache on message entity
- Model: OPENAI_GPT4_1_NANO (temp 0.1)

**Correction Check:**
- Input: Previous AI message + user message + target language
- LLM prompt: correction-check-prompt.md (ignores punctuation/capitalization, bolds corrections)
- Output: correctedText (null if no errors, handles gibberish/emoji input)
- Model: OPENAI_GPT4_1_NANO (temp 0.3)
- Access: Public endpoint with optional premium (both authenticated and anonymous)

**Speech-to-Text (STT) Transcription:**
- Endpoint: POST /ai/transcribe (premium-only, JWT required)
- Input: multipart/form-data with audio file (M4A, MP4, MPEG, WAV, max 10MB)
- Flow:
  1. Validate file type and size
  2. Persist audio to Supabase storage (user_audio/ bucket)
  3. Select preferred STT provider (configurable via STT_PROVIDER env var)
  4. Transcribe audio to text
  5. Return transcribed text in response
  6. If primary provider fails, fallback to secondary provider
- **Primary Provider:** OpenAI Whisper (high accuracy, broader language support)
- **Fallback Provider:** Google Gemini multimodal (graceful degradation)
- **Configuration:** STT_PROVIDER env var (default: "openai", options: "openai" | "gemini")
- **Rate Limiting:** Inherits AI module throttling (20 req/min, 100 req/hr per user)

### Subscription Module Flow
```
┌──────────────────────────────────────────────────────┐
│    Subscription Controller & Webhook Controller      │
│  GET /subscriptions/me                              │
│  POST /subscriptions/sync (mobile-initiated)        │
│  POST /webhooks/revenuecat (public, bearer auth)   │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│        Subscription Service                          │
│  - getUserSubscription()                            │
│  - syncSubscription() → RevenueCat API              │
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

**Sync Flow (Mobile → Backend):**
```
1. Mobile app calls POST /subscriptions/sync
2. Backend queries RevenueCat API with user's app_user_id
3. Parse entitlements from RevenueCat response
4. Upsert local Subscription record
5. Return updated subscription status to client
```

### Onboarding Module Flow
```
┌──────────────────────────────────────────────────────┐
│      Onboarding Controller (No Auth Required)        │
│  POST /onboarding/start, /chat, /complete           │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│        Onboarding Service                            │
│  - createSession()                                  │
│  - processMessage()                                 │
│  - extractProfile()                                 │
│  - cleanupExpiredSessions()                         │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│        AI Learning Agent (for Onboarding)           │
│  - Session-based state management                   │
│  - Profile extraction via AI                        │
│  - Max 10 turns per session                         │
│  - 7-day session TTL                                │
└──────────────────────────────────────────────────────┘
```

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

**Visibility Filter Logic:**
```
Scenario is visible if:
  (is_active = true) AND
  (
    language_id IS NULL OR
    language_id = requested_language_id OR
    scenario_id IN user_scenario_access(user_id)
  )
```

**Status Computation:**
```
scenario_status = {
  'learned'   if user completed scenario (future: UserProgress lookup)
  'locked'    if is_premium && user.subscription.plan == 'free' && !is_trial
  'trial'     if is_trial && user.subscription.plan == 'free'
  'available' otherwise
}
```

### Scenario Chat Module Flow
```
┌──────────────────────────────────────────────────────┐
│        Scenario Chat Controller                      │
│  POST /scenario/chat                                │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│        Scenario Chat Service                         │
│  - validateScenarioAccess()                         │
│  - generateAIReply()                                │
│  - updateConversationState()                        │
│  - checkCompletionStatus()                          │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│      Scenario Access Service                         │
│  - checkPremiumAccess()                             │
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
│  - Subscription (premium check)                     │
│  - Scenario (premium/trial flags)                   │
└──────────────────────────────────────────────────────┘
```

**Turn-Based Conversation Flow:**
```
1. User sends first message (without message parameter) → AI initiates
2. User sends subsequent messages → AI responds based on conversation history
3. Each turn increments turn counter
4. When turn == maxTurns → completed: true
5. Completed conversations cannot accept new messages
```

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

**Leitner Box Transitions:**
```
Correct Answer:
  Box 1 → Box 2: due_at += 3 days
  Box 2 → Box 3: due_at += 7 days
  Box 3 → Box 4: due_at += 14 days
  Box 4 → Box 5: due_at += 30 days
  Box 5 → Box 5: due_at += 30 days (cap, no promotion)

Incorrect Answer (any box):
  → Box 1: due_at += 1 day
```

**Key Invariants:**
- Once session created, card cannot be re-rated in same session
- Session expiry does NOT auto-delete vocabulary (session store only)
- dueAt is exclusive: due cards query uses `due_at <= NOW()`
- reviewCount incremented on every rating (correct or wrong)
- correctCount incremented only on correct ratings

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

Language (1) ──< (N) UserLanguage
Language (1) ──< (N) Lesson
Language (1) ──< (N) Scenario  (nullable: scenarios can be global)

ScenarioCategory (1) ──< (N) Scenario
Scenario (1) ──< (N) UserScenarioAccess
Scenario (1) ──< (N) AiConversation  (for scenario chat)
User (1) ──< (N) Scenario  (as creator, nullable)

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
- **Database:** PostgreSQL 14+ (Supabase)
- **Features:** Row-Level Security (RLS), timestamptz columns, UUID PKs, CASCADE deletion, indexed columns
- **Connection:** TypeORM connection pool with auto-reconnect

## Security Architecture

### Authentication Flow
```
1. User Login/Register
   ↓
2. Validate Credentials (bcrypt hash comparison)
   ↓
3. Generate JWT Token (HS256 signed, 7d expiry)
   ↓
4. Store Refresh Token (composite format, device info)
   ↓
5. Return Token Pair to Client
   ↓
6. Client Includes JWT in Authorization Header
   ↓
7. JwtAuthGuard Validates Token
   ↓
8. Extract User from Payload
   ↓
9. Attach User to Request Context
   ↓
10. Controller Access via @CurrentUser() Decorator
```

### Google OAuth Flow (ID Token)
```
1. Client Obtains Google ID Token (via SDK)
   ↓
2. Client Sends POST /auth/google with idToken
   ↓
3. Backend Verifies ID Token (google-auth-library)
   ↓
4. Extract User Email & Profile from Token Payload
   ↓
5. Check if User Exists (by email)
   ↓
6. If Exists: Auto-link account (store googleProviderId)
   ↓
7. If Not Exists: Create new user
   ↓
8. Generate JWT Token
   ↓
9. Return Access Token to Client
```

### Apple OAuth Flow
```
1. Client Obtains Apple Identity Token (via SDK)
   ↓
2. Client Sends POST /auth/apple with identityToken
   ↓
3. Backend Verifies Token (apple-signin-auth library)
   ↓
4. Extract User Email & Profile from Token Payload
   ↓
5. Check if User Exists (by email)
   ↓
6. If Exists: Auto-link account (store appleProviderId)
   ↓
7. If Not Exists: Create new user
   ↓
8. Generate JWT Token
   ↓
9. Return Access Token to Client
```

### Password Reset Flow
```
1. User requests password reset via /forgot-password
   ↓
2. Generate OTP (10-minute expiry)
   ↓
3. Send OTP via email (Nodemailer)
   ↓
4. User verifies OTP via /verify-otp
   ↓
5. Generate reset token (15-minute expiry)
   ↓
6. User resets password via /reset-password
   ↓
7. Update password hash, invalidate reset token
```

### Webhook Security (RevenueCat)
```
1. RevenueCat Sends Webhook with Bearer Token
   ↓
2. Extract Authorization Header
   ↓
3. Timing-Safe Comparison with Secret
   ↓
4. Reject if Invalid (UnauthorizedException)
   ↓
5. Validate Payload Schema (DTO validation)
   ↓
6. Respond Immediately (< 60s)
   ↓
7. Process Asynchronously (setImmediate)
   ↓
8. Update Database
   ↓
9. Log Errors (no retry)
```

### Database Security
- Row-Level Security (RLS) on all tables
- Service role key for backend operations
- User data isolated via user_id FK
- CASCADE deletion on user removal

## External Integrations

| Service | Purpose | Auth | Features |
|---------|---------|------|----------|
| **Supabase** | PostgreSQL + Storage | Service role key | Database, RLS, file storage |
| **RevenueCat** | Subscription management | Bearer token | Webhook events, status checks |
| **Firebase** | Push notifications | Service account JSON | FCM, multi-device support |
| **OpenAI** | GPT models | API key | GPT-4o, GPT-4o-mini |
| **Anthropic** | Claude models | API key | Claude 3.5 Sonnet, Haiku |
| **Google AI** | Gemini models | API key | Gemini 2.5 Flash, 1.5 Pro |
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
  - Applied to OpenAI, Anthropic, and Gemini providers
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
- **Provider:** Supabase (managed PostgreSQL)
- **Migrations:** Automated via TypeORM CLI
- **Backups:** Automated daily backups

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

## Technology Decisions

**Why NestJS?** Enterprise architecture, TypeScript support, DI, extensive ecosystem

**Why TypeORM?** TypeScript-first ORM, migration support, Active Record & Repository patterns

**Why Supabase?** Managed PostgreSQL, RLS, real-time ready, generous free tier

**Why RevenueCat?** Cross-platform subscriptions, handles App Store/Play Store, webhook-based

**Why Firebase?** Industry-standard FCM, multi-platform, reliable delivery, free tier

**Why LangChain?** Multi-provider AI abstraction, agent framework, production-ready

## Constraints & Trade-offs

**Current Limitations:**
- No distributed caching (single instance)
- No background job processing (all synchronous)
- No GraphQL (REST only)
- No real-time features (REST polling)

**Trade-offs Made:**
- **Simplicity vs. Performance:** Chose simpler architecture for faster development
- **Cost vs. Features:** Using free tiers where possible
- **Monolith vs. Microservices:** Monolithic for easier development
- **SQL vs. NoSQL:** PostgreSQL for ACID compliance and relational data
