# Codebase Summary

**Last Updated:** 2026-02-04

## Overview

AI-powered language learning backend built with NestJS, TypeScript, and PostgreSQL (Supabase). Provides authentication, AI-driven learning features, subscription management via RevenueCat, and push notifications via Firebase.

## Tech Stack

- **Framework:** NestJS 10.x
- **Language:** TypeScript 5.x
- **Database:** PostgreSQL (Supabase)
- **ORM:** TypeORM
- **Authentication:** JWT, OAuth (Google, Apple)
- **AI Services:** OpenAI, Anthropic, Google AI
- **Subscriptions:** RevenueCat
- **Push Notifications:** Firebase Cloud Messaging
- **Monitoring:** Sentry, Langfuse

## Project Structure

```
src/
├── app.module.ts              # Root module
├── main.ts                    # Application entry point
├── common/                    # Shared utilities
│   ├── decorators/           # Custom decorators (Public route, CurrentUser)
│   ├── filters/              # Exception filters
│   ├── guards/               # Auth guards (JWT, optional JWT)
│   └── interceptors/         # Response interceptors
├── config/                    # Configuration
│   ├── app-configuration.ts  # App config interface & factory
│   └── environment-validation-schema.ts  # Joi validation schema
├── database/                  # Database layer
│   ├── entities/             # TypeORM entities
│   ├── migrations/           # Database migrations
│   ├── database.module.ts    # Database module config
│   └── supabase.service.ts   # Supabase client wrapper
├── modules/                   # Feature modules
│   ├── auth/                 # Authentication & authorization
│   ├── user/                 # User profile management
│   ├── ai/                   # AI-powered learning features
│   ├── subscription/         # RevenueCat subscription management
│   └── notification/         # Firebase push notifications
└── scripts/                   # CLI scripts
```

## Core Modules

### Authentication Module
**Location:** `src/modules/auth/`

Handles user authentication via JWT and OAuth providers.

**Features:**
- Local signup/login with email & password
- Google OAuth integration
- Apple Sign-In integration
- JWT-based session management
- Password reset flow
- Email verification

**Endpoints:**
- `POST /auth/signup` - Register new user
- `POST /auth/login` - Login with credentials
- `POST /auth/google` - Google OAuth callback
- `POST /auth/apple` - Apple Sign-In callback
- `POST /auth/refresh` - Refresh JWT token
- `POST /auth/reset-password` - Request password reset
- `POST /auth/verify-email` - Verify email address

**Key Files:**
- `auth.service.ts` - Core auth logic
- `jwt.strategy.ts` - JWT Passport strategy
- `google.strategy.ts` - Google OAuth strategy
- `apple.strategy.ts` - Apple OAuth strategy

### User Module
**Location:** `src/modules/user/`

Manages user profiles and preferences.

**Features:**
- Profile retrieval and updates
- User preferences management
- Learning progress tracking

**Endpoints:**
- `GET /users/me` - Get current user profile
- `PATCH /users/me` - Update profile
- `GET /users/me/preferences` - Get user preferences

### AI Module
**Location:** `src/modules/ai/`

Provides AI-driven language learning features using multiple AI providers.

**Features:**
- Conversation practice with AI tutors
- Vocabulary learning and explanations
- Grammar correction and feedback
- Translation services
- Multi-provider support (OpenAI, Anthropic, Google AI)
- Usage tracking via Langfuse

**Endpoints:**
- `POST /ai/conversation` - Start/continue conversation
- `POST /ai/vocabulary/explain` - Get vocabulary explanations
- `POST /ai/grammar/check` - Grammar correction
- `POST /ai/translate` - Translation service

**Key Services:**
- `ai.service.ts` - Main AI orchestration
- `ai-client-factory.ts` - Multi-provider client factory
- `openai-client.ts` - OpenAI integration
- `anthropic-client.ts` - Anthropic Claude integration
- `google-ai-client.ts` - Google Gemini integration

### Subscription Module
**Location:** `src/modules/subscription/`

Manages user subscriptions via RevenueCat integration.

**Features:**
- Subscription status retrieval
- RevenueCat webhook processing
- Automatic subscription lifecycle management
- Multiple plan types (free, monthly, yearly, lifetime)

**Endpoints:**
- `GET /subscriptions/me` - Get current subscription
- `POST /webhooks/revenuecat` - RevenueCat webhook (public)

**Subscription Plans:**
- `free` - Default free tier
- `monthly` - Monthly subscription
- `yearly` - Annual subscription
- `lifetime` - One-time purchase

**Subscription Status:**
- `active` - Active subscription
- `expired` - Expired subscription
- `cancelled` - Cancelled subscription
- `trial` - Trial period

**Key Files:**
- `subscription.service.ts` - Subscription business logic
- `revenuecat-webhook.controller.ts` - Webhook handler
- `subscription.entity.ts` - Subscription data model

### Notification Module
**Location:** `src/modules/notification/`

Handles push notifications via Firebase Cloud Messaging.

**Features:**
- Device token registration/unregistration
- Multi-device support per user
- Platform-specific handling (iOS, Android, Web)
- Firebase Admin SDK integration

**Endpoints:**
- `POST /notifications/devices` - Register device token
- `DELETE /notifications/devices/:token` - Unregister device

**Device Platforms:**
- `ios` - iOS devices
- `android` - Android devices
- `web` - Web push notifications

**Key Files:**
- `notification.service.ts` - Device management logic
- `firebase.service.ts` - Firebase Admin SDK wrapper
- `notification.entity.ts` - Device token storage

## Database Schema

### Core Tables

**users**
- Primary user account table
- Fields: id, email, password_hash, name, profile_picture, email_verified, created_at, updated_at
- Indexes: email (unique)

**subscriptions**
- User subscription data
- Fields: id, user_id, plan, status, revenuecat_id, current_period_start, current_period_end, cancel_at_period_end
- Foreign keys: user_id → users(id) ON DELETE CASCADE
- Indexes: user_id (unique), revenuecat_id

**notification_devices**
- FCM device tokens
- Fields: id, user_id, token, platform, device_name, last_used_at, created_at
- Foreign keys: user_id → users(id) ON DELETE CASCADE
- Indexes: user_id, token (unique)

### Row-Level Security (RLS)

All tables implement Supabase RLS policies:
- Users can only read/update their own data
- Public access restricted via service role key
- Webhook endpoints bypass RLS using service credentials

## Configuration

### Environment Variables

**Application:**
- `NODE_ENV` - Environment (development, production)
- `PORT` - Server port (default: 3000)
- `CORS_ALLOWED_ORIGINS` - Allowed CORS origins (comma-separated)

**Database:**
- `DATABASE_URL` - PostgreSQL connection string
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key

**Authentication:**
- `JWT_SECRET` - JWT signing secret (min 32 chars)
- `JWT_EXPIRES_IN` - Token expiration (default: 7d)
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `GOOGLE_CALLBACK_URL` - Google OAuth callback URL
- `APPLE_CLIENT_ID` - Apple Sign-In client ID

**Subscriptions:**
- `REVENUECAT_API_KEY` - RevenueCat REST API key
- `REVENUECAT_WEBHOOK_SECRET` - Webhook authorization secret

**Push Notifications:**
- `FIREBASE_PROJECT_ID` - Firebase project ID
- `FIREBASE_CLIENT_EMAIL` - Service account email
- `FIREBASE_PRIVATE_KEY` - Service account private key

**AI Services:**
- `OPENAI_API_KEY` - OpenAI API key (optional)
- `ANTHROPIC_API_KEY` - Anthropic API key (optional)
- `GOOGLE_AI_API_KEY` - Google AI API key (optional)
- `LANGFUSE_PUBLIC_KEY` - Langfuse observability key (optional)
- `LANGFUSE_SECRET_KEY` - Langfuse secret key (optional)
- `LANGFUSE_HOST` - Langfuse host URL (default: https://cloud.langfuse.com)

**Monitoring:**
- `SENTRY_DSN` - Sentry error tracking DSN (optional)

## Security Considerations

### Authentication
- Passwords hashed using bcrypt with salt rounds
- JWT tokens signed with HS256 algorithm
- OAuth tokens validated via provider APIs
- Email verification required for sensitive operations

### Webhook Security
- RevenueCat webhooks use Bearer token authorization
- Timing-safe comparison to prevent timing attacks
- Request validation via DTO schemas
- Async processing to meet 60s response requirement

### Database Security
- Row-Level Security (RLS) enabled on all tables
- Service role key used only for backend operations
- User data isolated via user_id foreign keys
- CASCADE deletion on user account removal

### API Security
- JWT authentication required for all endpoints (except public routes)
- CORS restricted to allowed origins
- Rate limiting recommended (not yet implemented)
- Input validation via class-validator DTOs

## Development Workflow

### Running Locally
```bash
npm install
npm run start:dev  # Development mode with hot reload
```

### Database Migrations
```bash
npm run migration:run     # Apply pending migrations
npm run migration:revert  # Rollback last migration
npm run migration:create  # Create new migration
```

### Testing
```bash
npm run test              # Unit tests
npm run test:e2e          # End-to-end tests
npm run test:cov          # Coverage report
```

### Code Quality
```bash
npm run lint              # ESLint check
npm run format            # Prettier format
```

## API Documentation

Swagger documentation available at `/api/docs` when running in development mode.

## Deployment

- **Platform:** Cloud-based (Supabase for database)
- **Environment:** Node.js runtime
- **Database:** Managed PostgreSQL via Supabase
- **Secrets:** Environment variables via hosting platform

## Monitoring & Observability

- **Error Tracking:** Sentry integration for production errors
- **AI Observability:** Langfuse for AI request tracing
- **Application Logs:** NestJS Logger with context-based logging
- **Webhook Logging:** Detailed logs for RevenueCat webhook events

## Future Enhancements

- Rate limiting middleware
- Redis caching layer
- Background job processing
- Email notification service
- Admin dashboard
- Analytics tracking
- Content recommendation engine
- Social features (friends, leaderboards)

## Metrics

- **Total Files:** 132 files processed
- **Code Lines:** ~12,500 lines
- **Modules:** 5 feature modules
- **Database Tables:** 3+ tables
- **API Endpoints:** 20+ endpoints
- **External Integrations:** 6 (Supabase, RevenueCat, Firebase, OpenAI, Anthropic, Google AI)
