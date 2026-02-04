# Project Overview & PDR

**Last Updated:** 2026-02-04
**Version:** 1.0
**Status:** Active Development

## Executive Summary

AI-powered language learning backend built with NestJS and TypeScript. Provides authentication, AI-driven learning features, subscription management via RevenueCat, and push notifications via Firebase. Designed for mobile-first language learning applications targeting iOS and Android platforms.

## Product Vision

Create a scalable, secure backend infrastructure that powers personalized AI-driven language learning experiences. Enable seamless subscription management, real-time notifications, and multi-platform AI tutoring.

## Core Features

### 1. Authentication & User Management
- Email/password authentication with JWT
- Google OAuth integration
- Apple Sign-In integration
- Email verification
- Password reset flow
- User profile management

### 2. AI-Powered Learning
- Conversation practice with AI tutors
- Vocabulary explanations and learning
- Grammar correction and feedback
- Translation services
- Multi-provider AI support (OpenAI, Anthropic, Google AI)
- Usage tracking and observability (Langfuse)

### 3. Subscription Management
- RevenueCat integration for cross-platform subscriptions
- Webhook-based subscription lifecycle management
- Multiple plan types (free, monthly, yearly, lifetime)
- Automatic subscription status updates
- Real-time subscription status retrieval

### 4. Push Notifications
- Firebase Cloud Messaging integration
- Multi-device support per user
- Cross-platform token management (iOS, Android, Web)
- Device registration and cleanup

## Technical Stack

### Backend Framework
- **NestJS 10.x** - Enterprise-grade TypeScript framework
- **TypeScript 5.x** - Type-safe development
- **Node.js 18+** - Runtime environment

### Database
- **PostgreSQL 14+** - Primary database (hosted on Supabase)
- **TypeORM** - ORM with migration support
- **Supabase** - Managed PostgreSQL with RLS

### Authentication
- **Passport.js** - Authentication middleware
- **JWT** - Token-based authentication
- **bcrypt** - Password hashing

### External Integrations
- **RevenueCat** - Subscription management
- **Firebase Admin SDK** - Push notifications
- **OpenAI API** - GPT models for conversation
- **Anthropic API** - Claude models for reasoning
- **Google AI API** - Gemini models for multimodal
- **Langfuse** - AI observability

### Monitoring & Logging
- **Sentry** - Error tracking
- **NestJS Logger** - Application logging
- **Langfuse** - AI request tracing

## Product Development Requirements

### Functional Requirements

#### FR-1: User Authentication
- **Priority:** Critical
- **Description:** Users must be able to create accounts, login, and manage sessions
- **Acceptance Criteria:**
  - Users can register with email/password
  - Users can login with Google OAuth
  - Users can login with Apple Sign-In
  - JWT tokens expire after configured duration
  - Email verification required for sensitive operations
  - Password reset via email link

#### FR-2: AI Learning Features
- **Priority:** Critical
- **Description:** Users can practice language learning with AI assistance
- **Acceptance Criteria:**
  - Users can start conversation practice with AI
  - Users can request vocabulary explanations
  - Users can get grammar feedback
  - Users can translate text between languages
  - System supports multiple AI providers with fallback
  - AI requests are tracked for usage monitoring

#### FR-3: Subscription Management
- **Priority:** High
- **Description:** Users can subscribe to premium features via RevenueCat
- **Acceptance Criteria:**
  - Users can view current subscription status
  - Subscriptions are automatically updated via webhooks
  - System supports free, monthly, yearly, and lifetime plans
  - Subscription expiration is tracked and enforced
  - Webhooks respond within 60 seconds
  - Failed webhook processing is logged

#### FR-4: Push Notifications
- **Priority:** Medium
- **Description:** Users receive push notifications for learning reminders and updates
- **Acceptance Criteria:**
  - Users can register device tokens for FCM
  - Users can unregister devices
  - System supports iOS, Android, and Web platforms
  - Multiple devices per user are supported
  - Device tokens are cleaned up on unregistration

### Non-Functional Requirements

#### NFR-1: Security
- **Priority:** Critical
- **Requirements:**
  - All passwords hashed with bcrypt (10 salt rounds minimum)
  - JWT tokens signed with HS256 algorithm
  - Webhook authorization using timing-safe comparison
  - Row-Level Security (RLS) enabled on all database tables
  - No sensitive data in logs or error messages
  - CORS restricted to allowed origins
  - Input validation on all API endpoints

#### NFR-2: Performance
- **Priority:** High
- **Requirements:**
  - API response time < 500ms for 95th percentile
  - Database queries optimized with indexes
  - Webhook processing completes asynchronously
  - No N+1 query issues
  - Connection pooling for database
  - Efficient AI provider selection

#### NFR-3: Scalability
- **Priority:** Medium
- **Requirements:**
  - Stateless application design for horizontal scaling
  - Database connection pooling
  - Async webhook processing to prevent blocking
  - Support for multiple AI provider instances
  - Modular architecture for feature isolation

#### NFR-4: Reliability
- **Priority:** High
- **Requirements:**
  - 99.9% uptime for API endpoints
  - Graceful error handling with meaningful messages
  - Database transactions for data consistency
  - Retry logic for transient failures
  - Comprehensive logging for debugging

#### NFR-5: Maintainability
- **Priority:** High
- **Requirements:**
  - Code coverage > 80%
  - TypeScript strict mode enabled
  - Consistent code formatting (Prettier)
  - Linting with ESLint
  - Clear separation of concerns (modules)
  - Comprehensive API documentation (Swagger)

#### NFR-6: Observability
- **Priority:** Medium
- **Requirements:**
  - Error tracking with Sentry
  - AI request tracing with Langfuse
  - Contextual logging with NestJS Logger
  - Webhook event logging
  - Health check endpoints (future)

## API Endpoints

### Authentication
- `POST /auth/signup` - Register new user
- `POST /auth/login` - Login with credentials
- `POST /auth/google` - Google OAuth callback
- `POST /auth/apple` - Apple Sign-In callback
- `POST /auth/refresh` - Refresh JWT token
- `POST /auth/reset-password` - Request password reset
- `POST /auth/verify-email` - Verify email address

### User Management
- `GET /users/me` - Get current user profile
- `PATCH /users/me` - Update profile
- `GET /users/me/preferences` - Get user preferences

### AI Features
- `POST /ai/conversation` - Start/continue conversation
- `POST /ai/vocabulary/explain` - Get vocabulary explanations
- `POST /ai/grammar/check` - Grammar correction
- `POST /ai/translate` - Translation service

### Subscriptions
- `GET /subscriptions/me` - Get current subscription
- `POST /webhooks/revenuecat` - RevenueCat webhook (public)

### Notifications
- `POST /notifications/devices` - Register FCM device token
- `DELETE /notifications/devices/:token` - Unregister device

## Data Models

### User
- `id` (UUID, PK)
- `email` (string, unique)
- `password_hash` (string)
- `name` (string, nullable)
- `profile_picture` (string, nullable)
- `email_verified` (boolean)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

### Subscription
- `id` (UUID, PK)
- `user_id` (UUID, FK → users)
- `plan` (enum: free, monthly, yearly, lifetime)
- `status` (enum: active, expired, cancelled, trial)
- `revenuecat_id` (string, nullable)
- `current_period_start` (timestamptz, nullable)
- `current_period_end` (timestamptz, nullable)
- `cancel_at_period_end` (boolean)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

### NotificationDevice
- `id` (UUID, PK)
- `user_id` (UUID, FK → users)
- `token` (string, unique)
- `platform` (enum: ios, android, web)
- `device_name` (string, nullable)
- `last_used_at` (timestamptz)
- `created_at` (timestamptz)

## Security Considerations

### Authentication Security
- Passwords hashed with bcrypt (10+ salt rounds)
- JWT tokens expire after configured duration (default: 7d)
- OAuth tokens validated via provider APIs
- Email verification required for account creation

### Webhook Security
- RevenueCat webhooks use Bearer token authorization
- Timing-safe comparison prevents timing attacks
- Request validation via DTO schemas
- Async processing meets 60s response requirement

### Database Security
- Row-Level Security (RLS) on all tables
- Service role key for backend operations only
- User data isolated via user_id foreign keys
- CASCADE deletion on user account removal

### API Security
- JWT authentication required by default
- Public routes explicitly marked with @Public()
- CORS restricted to allowed origins
- Input validation via class-validator
- Rate limiting recommended (future implementation)

## Success Metrics

### User Engagement
- Daily Active Users (DAU)
- Monthly Active Users (MAU)
- AI conversation sessions per user
- Average session duration

### Subscription Metrics
- Conversion rate (free → paid)
- Monthly Recurring Revenue (MRR)
- Churn rate
- Subscription plan distribution

### Technical Metrics
- API response time (p95, p99)
- Error rate
- Webhook processing success rate
- AI provider response time

### Quality Metrics
- Code coverage percentage
- Bug resolution time
- Deployment frequency
- Mean Time To Recovery (MTTR)

## Risk Assessment

### High-Priority Risks

**R-1: Webhook Processing Failures**
- **Impact:** Subscriptions not updated, revenue loss
- **Mitigation:** Comprehensive logging, async processing, error tracking
- **Fallback:** Manual subscription sync via RevenueCat API

**R-2: AI Provider Outages**
- **Impact:** Learning features unavailable
- **Mitigation:** Multi-provider support with automatic fallback
- **Fallback:** Graceful degradation with cached responses

**R-3: Security Vulnerabilities**
- **Impact:** Data breach, unauthorized access
- **Mitigation:** Security best practices, regular audits, RLS enforcement
- **Monitoring:** Sentry error tracking, audit logging

### Medium-Priority Risks

**R-4: Database Connection Exhaustion**
- **Impact:** API unavailability
- **Mitigation:** Connection pooling, query optimization
- **Monitoring:** Database connection metrics

**R-5: Third-Party Service Rate Limits**
- **Impact:** Feature degradation
- **Mitigation:** Rate limiting, caching, request throttling
- **Monitoring:** Usage tracking via Langfuse

## Deployment Strategy

### Environments
- **Development:** Local development with hot reload
- **Staging:** Pre-production testing environment
- **Production:** Live environment with monitoring

### Database Migrations
- Automated migrations via TypeORM CLI
- Version-controlled migration files
- Rollback capability for each migration

### CI/CD Pipeline (Future)
1. Code push to repository
2. Run linting and tests
3. Build TypeScript
4. Run database migrations
5. Deploy to staging
6. Run E2E tests
7. Deploy to production

## Future Enhancements

### Short-term (1-3 months)
- Redis caching layer for frequently accessed data
- Rate limiting middleware for API protection
- Health check endpoints for monitoring
- Comprehensive E2E test suite
- Admin dashboard for user management

### Medium-term (3-6 months)
- Background job processing with Bull
- Email notification service
- Content recommendation engine
- Analytics tracking and reporting
- Database read replicas for scalability

### Long-term (6-12 months)
- Real-time features via WebSocket
- Social features (friends, leaderboards)
- Gamification system (achievements, streaks)
- Voice-based learning features
- Microservices architecture for AI module
- GraphQL API alongside REST

## Development Workflow

### Setup
```bash
npm install
cp .env.example .env
# Configure environment variables
npm run migration:run
npm run start:dev
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

### Database Management
```bash
npm run migration:create  # Create new migration
npm run migration:run     # Apply pending migrations
npm run migration:revert  # Rollback last migration
```

## Stakeholder Communication

### Development Team
- Daily standup meetings
- Weekly sprint planning
- Code review process via pull requests
- Slack/Discord for async communication

### Product Management
- Weekly progress updates
- Monthly roadmap reviews
- Feature prioritization sessions
- User feedback integration

### Quality Assurance
- Test plan reviews
- Bug triage meetings
- Performance testing results
- Security audit reviews

## Success Criteria

### Phase 1: MVP (Complete)
- ✅ User authentication (email, Google, Apple)
- ✅ Basic AI learning features
- ✅ Subscription management via RevenueCat
- ✅ Push notification infrastructure
- ✅ Database schema and migrations

### Phase 2: Enhancement (Next)
- 🔲 Rate limiting and caching
- 🔲 Comprehensive test coverage
- 🔲 Admin dashboard
- 🔲 Email notifications
- 🔲 Analytics tracking

### Phase 3: Scale (Future)
- 🔲 Microservices architecture
- 🔲 Real-time features
- 🔲 Social features
- 🔲 Advanced analytics
- 🔲 Multi-language support

## Compliance & Legal

### Data Privacy
- GDPR compliance for EU users
- User data deletion upon request
- Privacy policy integration
- Cookie consent management

### Terms of Service
- Clear subscription terms
- Refund policy alignment with App Store/Play Store
- User-generated content policies
- AI usage disclosure

## Support & Maintenance

### Bug Reporting
- Sentry integration for automatic error reporting
- User feedback mechanism
- Priority levels (P0-P3)
- SLA response times

### Maintenance Windows
- Scheduled maintenance notifications
- Zero-downtime deployment strategy
- Database backup and recovery procedures

## Documentation

### Developer Documentation
- API documentation via Swagger (`/api/docs`)
- Codebase summary (`docs/codebase-summary.md`)
- System architecture (`docs/system-architecture.md`)
- Code standards (`docs/code-standards.md`)

### User Documentation
- API integration guides
- Mobile SDK examples
- Troubleshooting guides
- FAQ section

## Changelog

### Version 1.0 (2026-02-04)
- Initial release with core features
- Authentication module (email, Google, Apple)
- AI learning module (conversation, vocabulary, grammar, translation)
- Subscription module (RevenueCat integration)
- Notification module (Firebase FCM integration)
- Database schema and migrations
- Comprehensive documentation

## Contact & Resources

### Repository
- GitHub: [Repository URL]
- Documentation: `./docs/`
- Issue Tracker: GitHub Issues

### External Services
- Supabase Dashboard: [Project URL]
- RevenueCat Dashboard: [Dashboard URL]
- Firebase Console: [Console URL]
- Langfuse Dashboard: [Langfuse URL]
- Sentry Dashboard: [Sentry URL]

## Glossary

- **RLS:** Row-Level Security - PostgreSQL security feature
- **FCM:** Firebase Cloud Messaging - Push notification service
- **JWT:** JSON Web Token - Authentication token format
- **DTO:** Data Transfer Object - Validation schema
- **ORM:** Object-Relational Mapping - Database abstraction
- **PDR:** Product Development Requirements - This document
