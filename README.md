# AI Language Learning Backend

NestJS-based backend API for AI-powered language learning applications. Supports authentication, AI tutoring via multiple LLM providers, cross-platform subscriptions, and push notifications.

## Features

- **Authentication** - Email/password, Google OAuth, Apple Sign-In with JWT
- **AI Learning** - Chat tutoring, grammar checks, exercise generation, pronunciation assessment
- **Multi-LLM Support** - OpenAI GPT-4, Anthropic Claude, Google Gemini
- **Subscriptions** - RevenueCat integration for iOS/Android/Web
- **Push Notifications** - Firebase Cloud Messaging
- **Database** - PostgreSQL via Supabase with Row-Level Security
- **Observability** - Langfuse AI tracing, Sentry error tracking

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 11.0, TypeScript 5.7 |
| Database | PostgreSQL 14+ (Supabase), TypeORM 0.3.28 |
| Auth | JWT, Passport.js, bcrypt |
| AI | LangChain, OpenAI, Anthropic, Google AI |
| External | RevenueCat, Firebase Admin SDK |
| Docs | Swagger/OpenAPI |

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ (or Supabase account)
- One or more AI provider API keys (OpenAI/Anthropic/Google)
- Firebase service account (for push notifications)
- RevenueCat account (for subscriptions)

### Installation

```bash
# Clone repository
git clone <repository-url>
cd be_flowering

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run database migrations
npm run migration:run

# Start development server
npm run start:dev
```

Server runs on `http://localhost:3000`
Swagger docs available at `http://localhost:3000/api/docs`

## Environment Configuration

### Required Variables

```bash
# Application
NODE_ENV=development
PORT=3000
CORS_ALLOWED_ORIGINS=http://localhost:3001

# Database (Supabase)
DATABASE_URL=postgresql://postgres:password@localhost:5432/be_flowering
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Authentication
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_EXPIRES_IN=7d
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
APPLE_CLIENT_ID=your-apple-client-id

# Subscriptions (RevenueCat)
REVENUECAT_API_KEY=your-revenuecat-api-key
REVENUECAT_WEBHOOK_SECRET=your-webhook-secret

# Push Notifications (Firebase)
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour key here\n-----END PRIVATE KEY-----\n"
```

### Optional Variables

```bash
# AI Services (at least one recommended)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_API_KEY=AIza...

# AI Observability (Langfuse)
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com

# Error Tracking (Sentry)
SENTRY_DSN=https://...@sentry.io/...
```

## API Overview

### Authentication Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/auth/register` | Email/password signup | Public |
| POST | `/auth/login` | Email/password login | Public |
| GET | `/auth/google` | Initiate Google OAuth | Public |
| GET | `/auth/google/callback` | Google OAuth callback | Public |
| POST | `/auth/apple` | Apple Sign-In | Public |
| POST | `/auth/refresh` | Refresh access token | Public |
| POST | `/auth/logout` | Invalidate refresh token | JWT |

### User Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/users/me` | Get profile | JWT |
| PATCH | `/users/me` | Update profile | JWT |

### Language Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/language` | List all languages | Public |
| GET | `/language/user` | Get user's learning languages | JWT |
| POST | `/language/user` | Add language to learning list | JWT |
| PATCH | `/language/user/:id` | Update proficiency level | JWT |
| DELETE | `/language/user/:id` | Remove language | JWT |

### AI Endpoints

| Method | Endpoint | Description | Auth | Rate Limit |
|--------|----------|-------------|------|------------|
| POST | `/ai/chat` | Chat with AI tutor | JWT | 20/min, 100/hr |
| SSE | `/ai/chat/stream` | Stream chat response | JWT | 20/min, 100/hr |
| POST | `/ai/grammar/check` | Grammar correction | JWT | 20/min, 100/hr |
| POST | `/ai/exercises/generate` | Generate exercises | JWT | 20/min, 100/hr |
| POST | `/ai/pronunciation/assess` | Assess pronunciation (audio) | JWT | 20/min, 100/hr |
| POST | `/ai/conversations` | Start conversation session | JWT | 20/min, 100/hr |
| GET | `/ai/conversations/:id/messages` | Get conversation history | JWT | 20/min, 100/hr |

### Subscription Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/subscriptions/me` | Get subscription status | JWT |
| POST | `/webhooks/revenuecat` | RevenueCat webhook | Bearer token |

### Notification Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/notifications/devices` | Register FCM device token | JWT |
| DELETE | `/notifications/devices/:token` | Unregister device | JWT |

## Supported AI Models

### OpenAI
- `gpt-4` - Most capable, best reasoning
- `gpt-4-turbo` - Fast GPT-4 variant
- `gpt-3.5-turbo` - Fast, cost-effective

### Anthropic
- `claude-sonnet-4-20250514` - Balanced performance
- `claude-opus-4` - Most capable Claude
- `claude-haiku-3-5` - Fastest Claude

### Google AI
- `gemini-2.0-flash-exp` - Latest experimental
- `gemini-1.5-pro` - Best reasoning
- `gemini-1.5-flash` - Fast responses
- `gemini-1.0-pro` - Stable baseline

## Development

### Available Scripts

```bash
# Development
npm run start:dev        # Hot reload development server
npm run start:debug      # Debug mode with inspector

# Production
npm run build            # Compile TypeScript
npm run start:prod       # Run production build

# Database
npm run migration:generate -- src/database/migrations/Name  # Generate migration
npm run migration:run                                        # Apply migrations
npm run migration:revert                                     # Rollback last

# Code Quality
npm run lint             # ESLint check + auto-fix
npm run format           # Prettier formatting

# Testing
npm run test             # Unit tests
npm run test:watch       # Watch mode
npm run test:cov         # Coverage report
npm run test:e2e         # End-to-end tests
```

### Project Structure

```
src/
├── main.ts                    # Entry point
├── app.module.ts              # Root module (global JWT guard)
├── common/                    # Shared decorators, filters, interceptors
├── config/                    # Configuration & validation
├── database/                  # Entities, migrations, Supabase client
├── swagger/                   # API documentation setup
└── modules/                   # Feature modules
    ├── auth/                  # Authentication & OAuth
    ├── user/                  # User profile management
    ├── language/              # Language preferences
    ├── ai/                    # AI learning features (LangChain)
    ├── subscription/          # RevenueCat integration
    └── notification/          # Firebase push notifications
```

### Key Patterns

**Global Auth Guard:**
- All endpoints require JWT by default
- Use `@Public()` decorator to bypass auth
- Extract user with `@CurrentUser()` decorator

**Response Format:**
- All responses wrapped in `BaseResponseDto`:
  ```json
  { "code": 1, "message": "Success", "data": {...} }
  ```

**Error Handling:**
- Global `AllExceptionsFilter` catches all errors
- Returns structured error response:
  ```json
  { "code": 0, "message": "Error message", "data": null }
  ```

**Validation:**
- Global `ValidationPipe` with DTO transformation
- class-validator decorators on all DTOs
- Joi schema for environment variables

## Database Schema

### Core Tables

- **users** - User accounts (email, password_hash, profile)
- **refresh_tokens** - JWT refresh tokens with device tracking
- **languages** - Available languages catalog
- **user_languages** - User's learning languages with proficiency
- **subscriptions** - RevenueCat subscription data
- **device_tokens** - FCM push notification tokens
- **ai_conversations** - Chat session metadata
- **ai_conversation_messages** - Individual chat messages
- **lessons** - Language lessons (future content)
- **exercises** - Practice exercises (future content)
- **user_progress** - Lesson completion tracking (future)
- **user_exercise_attempts** - Exercise attempt history (future)

### Security

- **Row-Level Security (RLS)** enabled on all tables
- Users can only access their own data
- Backend uses service role key to bypass RLS
- CASCADE deletion on user account removal

## Deployment

### Build

```bash
npm run build
npm run start:prod
```

### Environment Requirements

- Node.js 18+
- PostgreSQL connection
- Public webhook endpoint for RevenueCat
- At least one AI provider API key
- Firebase service account JSON

### Horizontal Scaling

- Stateless design (JWT-based auth)
- Database connection pooling
- Refresh tokens in database (multi-instance safe)
- No in-memory session storage

## Documentation

- **API Docs:** `/api/docs` (Swagger UI, dev only)
- **Codebase Summary:** [`docs/codebase-summary.md`](./docs/codebase-summary.md)
- **Code Standards:** [`docs/code-standards.md`](./docs/code-standards.md)
- **System Architecture:** [`docs/system-architecture.md`](./docs/system-architecture.md)
- **Project Overview:** [`docs/project-overview-pdr.md`](./docs/project-overview-pdr.md)
- **Roadmap:** [`docs/project-roadmap.md`](./docs/project-roadmap.md)

## Monitoring

- **Error Tracking:** Sentry (optional, via `SENTRY_DSN`)
- **AI Observability:** Langfuse (optional, tracks prompts/responses/tokens)
- **Application Logs:** NestJS Logger with contextual information

## Security Best Practices

- Passwords hashed with bcrypt (6.0.0, 10+ rounds)
- JWT tokens signed with HS256 (7d expiry)
- OAuth tokens validated via provider APIs
- Webhook authorization with timing-safe comparison
- Input validation on all endpoints (class-validator)
- CORS restricted to allowed origins
- Rate limiting on AI endpoints (20/min, 100/hr)

## License

ISC

## Support

For issues and questions, please refer to the documentation in `./docs/` or check the Swagger API documentation at `/api/docs`.
