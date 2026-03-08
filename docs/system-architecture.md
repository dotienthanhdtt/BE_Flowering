# System Architecture

**Last Updated:** 2026-03-08

## Architecture Overview

AI-powered language learning backend following Clean Architecture principles with NestJS framework. Modular design with 8 feature modules and clear separation of concerns.

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
│  (Database, External APIs, Firebase, RevenueCat, AI)   │
└─────────────────────────────────────────────────────────┘
```

## Core Architecture Patterns

### 1. Modular Architecture
Each feature is self-contained with dependencies injected via NestJS DI.

**Module Structure:**
```
module/
├── dto/                    # Data Transfer Objects
├── module.controller.ts    # HTTP endpoints
├── module.service.ts       # Business logic
├── module.module.ts        # NestJS module definition
└── [additional services]   # Feature-specific services
```

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
│  POST /auth/register, /login, /google, /apple       │
│  POST /auth/refresh, /logout                         │
│  POST /auth/forgot-password, /verify-otp, /reset... │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│           Auth Service                               │
│  - validateUser()                                   │
│  - createUser()                                     │
│  - generateJWT()                                    │
│  - validateOAuth()                                  │
│  - processPasswordReset()                           │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│        Passport Strategies & Validators             │
│  - JwtStrategy (JWT validation)                     │
│  - GoogleIdTokenValidator (Google token verify)     │
│  - AppleStrategy (Apple OAuth)                      │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│           Database Layer                             │
│  UserRepository → PostgreSQL (Supabase)             │
│  PasswordResetRepository → PostgreSQL               │
└──────────────────────────────────────────────────────┘
```

**Key Features:**
- Composite refresh tokens (uuid:hex) for O(1) validation
- OAuth auto-linking to existing email
- Password reset: OTP (10min) + reset token (15min)
- Provider-specific IDs prevent duplicates

### AI Module Flow
```
┌──────────────────────────────────────────────────────┐
│           AI Controller                              │
│  POST /ai/chat, /grammar/check, /exercises/...     │
│  SSE /ai/chat/stream, /ai/conversations/:id/msgs   │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│           Learning Agent Service                     │
│  - processChat()                                    │
│  - checkGrammar()                                   │
│  - generateExercises()                              │
│  - assessPronunciation()                            │
└──────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│        Unified LLM Service                           │
│  - selectProvider()                                 │
│  - callLLM()                                        │
│  - handleFallback()                                 │
└──────────────────────────────────────────────────────┘
                    ↓
┌────────────────┬────────────────┬────────────────┐
│  OpenAI        │  Anthropic     │  Google AI     │
│  Provider      │  Provider      │  Provider      │
└────────────────┴────────────────┴────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│         Langfuse Observability                       │
│  - Trace AI requests                                │
│  - Log prompts & responses                          │
│  - Track usage metrics                              │
└──────────────────────────────────────────────────────┘
```

**AI Provider Selection:** Load balancing with fallback, cost optimization per request type

### Subscription Module Flow
```
┌──────────────────────────────────────────────────────┐
│      Subscription Controller & Webhook Controller    │
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
│        Webhook Processing Flow:                      │
│  1. Validate Bearer token (timing-safe)             │
│  2. Respond immediately with 200 (< 60s)            │
│  3. Process async via setImmediate()                │
│  4. Update subscription status in DB                │
│  5. Log processing errors                           │
└──────────────────────────────────────────────────────┘
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

## Database Architecture

### Entity Relationships
```
User (1) ──< (N) UserLanguage
User (1) ──< (1) Subscription
User (1) ──< (N) DeviceToken
User (1) ──< (N) AiConversation
User (1) ──< (N) RefreshToken
User (1) ──< (N) PasswordReset

Language (1) ──< (N) UserLanguage
Language (1) ──< (N) Lesson

Lesson (1) ──< (N) Exercise
Exercise (1) ──< (N) UserExerciseAttempt

AiConversation (1) ──< (N) AiConversationMessage
```

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

### Middleware Stack
1. **ValidationPipe:** Auto-transform DTOs, whitelist unknown properties
2. **ResponseTransformInterceptor:** Wrap all responses in `{code: 1, message, data}` format
3. **AllExceptionsFilter:** Global exception handler, Sentry integration for 5xx
4. **HttpLoggerMiddleware:** Log incoming requests and outgoing responses
5. **JwtAuthGuard:** Protect endpoints (bypass with @Public())
6. **CORS:** Configured via CORS_ALLOWED_ORIGINS

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
- **Request Tracing:** Langfuse for all AI provider requests
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
