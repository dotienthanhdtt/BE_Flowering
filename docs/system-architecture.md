# System Architecture

**Last Updated:** 2026-02-24

## Architecture Overview

AI-powered language learning backend following **Clean Architecture** principles with NestJS framework, implementing modular design with clear separation of concerns.

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
Each feature is self-contained in its own module with dependencies injected via NestJS DI.

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
NestJS IoC container manages all dependencies, enabling testability and loose coupling.

### 3. Repository Pattern
TypeORM provides repository abstraction for database operations.

### 4. Strategy Pattern
AI module uses strategy pattern for multi-provider support (OpenAI, Anthropic, Google AI).

### 5. Factory Pattern
AI client factory dynamically selects provider based on configuration.

## Module Architecture

### Authentication Module

```
┌──────────────────────────────────────────────────┐
│           Auth Controller                        │
│  POST /auth/signup                              │
│  POST /auth/login                               │
│  POST /auth/google                              │
│  POST /auth/apple                               │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│           Auth Service                           │
│  - validateUser()                               │
│  - createUser()                                 │
│  - generateJWT()                                │
│  - validateOAuth()                              │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│        Passport Strategies                       │
│  - JwtStrategy (JWT validation)                 │
│  - GoogleStrategy (OAuth)                       │
│  - AppleStrategy (OAuth)                        │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│           Database Layer                         │
│  UserRepository → PostgreSQL (Supabase)         │
└──────────────────────────────────────────────────┘
```

**Key Components:**
- **JwtAuthGuard:** Protects endpoints requiring authentication
- **OptionalJwtAuthGuard:** Allows optional authentication
- **Public Decorator:** Marks routes as public (bypasses auth)
- **CurrentUser Decorator:** Extracts user from request context

### Subscription Module

```
┌──────────────────────────────────────────────────┐
│      Subscription Controller                     │
│  GET /subscriptions/me                          │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│      RevenueCat Webhook Controller               │
│  POST /webhooks/revenuecat (Public)             │
│  - Timing-safe auth verification                │
│  - Async webhook processing                     │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│        Subscription Service                      │
│  - getUserSubscription()                        │
│  - processWebhook()                             │
│  - updateSubscriptionStatus()                   │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│         Database Layer                           │
│  SubscriptionRepository → PostgreSQL            │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│       External Integration                       │
│  RevenueCat REST API (future feature)           │
└──────────────────────────────────────────────────┘
```

**Webhook Flow:**
1. RevenueCat sends webhook to `/webhooks/revenuecat`
2. Controller validates Bearer token using timing-safe comparison
3. Responds immediately with `{ status: 'received' }` (< 60s requirement)
4. Processes webhook asynchronously via `setImmediate()`
5. Updates subscription status in database
6. Logs processing errors without failing webhook

**Subscription Lifecycle:**
- User purchases subscription in mobile app
- RevenueCat sends webhook event
- Backend updates subscription status
- User gains access to premium features

### Notification Module

```
┌──────────────────────────────────────────────────┐
│      Notification Controller                     │
│  POST /notifications/devices                    │
│  DELETE /notifications/devices/:token           │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│       Notification Service                       │
│  - registerDevice()                             │
│  - unregisterDevice()                           │
│  - sendNotification() (future)                  │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│        Firebase Service                          │
│  - initializeApp()                              │
│  - getMessaging()                               │
│  - send() (future feature)                      │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│         Database Layer                           │
│  NotificationDeviceRepository → PostgreSQL      │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│       External Integration                       │
│  Firebase Cloud Messaging (FCM)                 │
└──────────────────────────────────────────────────┘
```

**Push Notification Flow (Future):**
1. User triggers notification event (e.g., learning reminder)
2. Backend queries user's registered devices
3. Firebase service sends FCM message to each device
4. Updates `last_used_at` timestamp on successful delivery

### AI Module

```
┌──────────────────────────────────────────────────┐
│           AI Controller                          │
│  POST /ai/conversation                          │
│  POST /ai/vocabulary/explain                    │
│  POST /ai/grammar/check                         │
│  POST /ai/translate                             │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│           AI Service                             │
│  - processConversation()                        │
│  - explainVocabulary()                          │
│  - checkGrammar()                               │
│  - translate()                                  │
└──────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│        AI Client Factory                         │
│  - selectProvider() (strategy pattern)          │
│  - createClient()                               │
└──────────────────────────────────────────────────┘
                    ↓
┌────────────────┬────────────────┬────────────────┐
│  OpenAI Client │ Anthropic      │ Google AI      │
│                │ Client         │ Client         │
└────────────────┴────────────────┴────────────────┘
                    ↓
┌──────────────────────────────────────────────────┐
│         Langfuse Observability                   │
│  - Trace AI requests                            │
│  - Log prompts & responses                      │
│  - Track usage metrics                          │
└──────────────────────────────────────────────────┘
```

**AI Provider Selection Strategy:**
- Load balancing across providers
- Fallback on provider failure
- Cost optimization based on request type
- Feature-specific provider selection

## Database Architecture

### Entity Relationships

```
┌─────────────────┐
│     Users       │
│  - id (PK)      │
│  - email        │
│  - password     │
│  - name         │
└─────────────────┘
        │
        │ 1:1
        ↓
┌─────────────────┐
│ Subscriptions   │
│  - id (PK)      │
│  - user_id (FK) │
│  - plan         │
│  - status       │
│  - revenuecat_id│
└─────────────────┘

        │ 1:N
        ↓
┌─────────────────┐
│ Notification    │
│    Devices      │
│  - id (PK)      │
│  - user_id (FK) │
│  - token        │
│  - platform     │
└─────────────────┘
```

### Database Layer

**Technology:** PostgreSQL 14+ (hosted on Supabase)

**Features:**
- Row-Level Security (RLS) for multi-tenant isolation
- Timestamptz columns for timezone-aware dates
- UUID primary keys for security
- Foreign key constraints with CASCADE deletion
- Indexed columns for query optimization

**Connection Management:**
- TypeORM connection pool
- Environment-based configuration
- Automatic reconnection on failure

## Security Architecture

### Authentication Flow

```
1. User Login Request
   ↓
2. Validate Credentials (bcrypt hash comparison)
   ↓
3. Generate JWT Token (HS256 signed)
   ↓
4. Return Token to Client
   ↓
5. Client Includes Token in Authorization Header
   ↓
6. JwtAuthGuard Validates Token
   ↓
7. Extract User from Payload
   ↓
8. Attach User to Request Context
   ↓
9. Controller Access via @CurrentUser() Decorator
```

### Google OAuth Flow (ID Token)

```
1. Client Obtains Google ID Token (from mobile/web SDK)
   ↓
2. Client Sends POST /auth/google with idToken
   ↓
3. Backend Verifies ID Token with google-auth-library
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
1. Client Obtains Apple Identity Token (from mobile SDK)
   ↓
2. Client Sends POST /auth/apple with identityToken
   ↓
3. Backend Verifies with apple-signin-auth library
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

**Key Improvement:** Auto-linking prevents duplicate accounts when user authenticates via different OAuth provider with same email.

### Webhook Security (RevenueCat)

```
1. RevenueCat Sends Webhook with Bearer Token
   ↓
2. Extract Authorization Header
   ↓
3. Timing-Safe Comparison with Expected Secret
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
9. Log Errors (no retry on webhook failure)
```

## External Integrations

### Supabase Integration
- **Purpose:** PostgreSQL database hosting + Row-Level Security
- **Authentication:** Service role key for backend operations
- **Features Used:** Database, RLS policies, real-time subscriptions (future)

### RevenueCat Integration
- **Purpose:** Cross-platform subscription management
- **Integration Type:** Webhook-based event processing
- **Events Handled:** Purchase, renewal, cancellation, expiration
- **Security:** Bearer token authentication

### Firebase Integration
- **Purpose:** Push notification delivery
- **Integration Type:** Firebase Admin SDK
- **Authentication:** Service account credentials (JSON key)
- **Features Used:** Cloud Messaging (FCM)

### AI Providers
- **OpenAI:** GPT models for conversation and text generation
- **Anthropic:** Claude models for advanced reasoning
- **Google AI:** Gemini models for multimodal capabilities
- **Langfuse:** AI observability and tracing

## Scalability Considerations

### Current Architecture
- **Horizontal Scaling:** Stateless NestJS application
- **Database:** Managed PostgreSQL with connection pooling
- **Webhooks:** Async processing prevents blocking

### Future Enhancements
- **Caching Layer:** Redis for session data and frequent queries
- **Background Jobs:** Bull/BullMQ for async task processing
- **CDN:** Static asset delivery for media content
- **Load Balancer:** Distribute traffic across multiple instances
- **Database Read Replicas:** Separate read/write workloads
- **Message Queue:** RabbitMQ/SQS for event-driven architecture

## Monitoring & Observability

### Application Monitoring
- **Error Tracking:** Sentry for production errors
- **Logging:** NestJS Logger with contextual information
- **Health Checks:** `/health` endpoint (future feature)

### AI Monitoring
- **Request Tracing:** Langfuse for AI provider requests
- **Usage Tracking:** Token consumption and cost analysis
- **Performance:** Response time and latency metrics

### Webhook Monitoring
- **Logging:** Detailed logs for all webhook events
- **Error Tracking:** Async processing errors logged separately
- **Validation:** DTO schema validation errors captured

## Configuration Management

### Environment-Based Config
```typescript
@Module({
  imports: [
    ConfigModule.forRoot({
      load: [appConfiguration],
      validationSchema: environmentValidationSchema,
    }),
  ],
})
```

### Validation Schema
All environment variables validated on application startup using Joi schema.

### Configuration Access
```typescript
constructor(private configService: ConfigService) {}

const apiKey = this.configService.get<string>('revenuecat.apiKey');
```

## Deployment Architecture

### Application Deployment
- **Platform:** Cloud hosting (e.g., Vercel, Railway, AWS)
- **Runtime:** Node.js 18+
- **Build:** TypeScript compiled to JavaScript
- **Environment:** Production environment variables

### Database Deployment
- **Provider:** Supabase (managed PostgreSQL)
- **Migrations:** Automated via TypeORM CLI
- **Backups:** Automated daily backups (Supabase)

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

## API Design Principles

### RESTful Conventions
- **GET:** Retrieve resources
- **POST:** Create resources or trigger actions
- **PATCH:** Partial update
- **DELETE:** Remove resources

### Response Format
```json
{
  "data": {},
  "message": "Success message",
  "statusCode": 200
}
```

### Error Format
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

### Versioning Strategy
- Currently: No versioning (v1 implicit)
- Future: URL-based versioning (`/v2/...`)

## Data Flow Examples

### User Subscription Update Flow
```
1. User purchases subscription in mobile app
   ↓
2. RevenueCat processes payment via App Store/Play Store
   ↓
3. RevenueCat sends webhook to backend
   ↓
4. Backend validates webhook authorization
   ↓
5. Backend updates subscription record in database
   ↓
6. User's next API request reflects updated subscription
   ↓
7. Frontend displays premium features
```

### Push Notification Registration Flow
```
1. User logs in on mobile device
   ↓
2. App requests FCM token from Firebase SDK
   ↓
3. App sends token to backend via POST /notifications/devices
   ↓
4. Backend stores token with user_id and platform
   ↓
5. Backend can now send push notifications to this device
   ↓
6. User uninstalls app → token becomes invalid
   ↓
7. App sends DELETE request on logout (optional cleanup)
```

## Technology Decisions

### Why NestJS?
- Enterprise-grade architecture out of the box
- Strong TypeScript support
- Dependency injection and modularity
- Extensive ecosystem (Passport, TypeORM, Swagger)

### Why TypeORM?
- TypeScript-first ORM with decorator-based entities
- Migration support for version control
- Active Record and Repository patterns
- Good PostgreSQL support

### Why Supabase?
- Managed PostgreSQL with RLS for security
- Real-time subscriptions (future feature)
- Built-in authentication (not used, but available)
- Generous free tier for development

### Why RevenueCat?
- Cross-platform subscription management (iOS, Android, Web)
- Handles App Store/Play Store complexity
- Webhook-based integration
- Analytics and reporting dashboard

### Why Firebase?
- Industry-standard push notification service
- Multi-platform support (iOS, Android, Web)
- Reliable delivery with retries
- Free tier sufficient for most use cases

## Constraints & Trade-offs

### Current Limitations
- No rate limiting (potential abuse vector)
- Synchronous webhook processing (blocking under heavy load)
- No caching layer (database overhead on frequent queries)
- No background job processing (all tasks synchronous)

### Trade-offs Made
- **Simplicity vs. Performance:** Chose simpler architecture for faster development
- **Cost vs. Features:** Using free tiers where possible
- **Monolith vs. Microservices:** Monolithic for easier development and deployment
- **SQL vs. NoSQL:** PostgreSQL for ACID compliance and relational data

## Future Architecture Evolution

### Short-term (1-3 months)
- Add Redis caching layer
- Implement rate limiting middleware
- Add health check endpoints
- Implement proper logging aggregation

### Medium-term (3-6 months)
- Background job processing with Bull
- Database read replicas for scalability
- API versioning strategy
- Comprehensive monitoring dashboard

### Long-term (6-12 months)
- Microservices architecture for AI module
- Event-driven architecture with message queues
- GraphQL API alongside REST
- Real-time features via WebSocket
