# Project Roadmap

**Last Updated:** 2026-04-12
**Project:** AI Language Learning Backend
**Status:** Phase 1 Complete, Phase 2 In Progress (95%)

## Vision

Build a scalable, production-ready backend infrastructure that powers AI-driven language learning experiences with multi-platform support, comprehensive observability, and enterprise-grade security.

## Roadmap Phases

### Phase 1: MVP Foundation ✅ (Complete - 2026-02-04)

**Duration:** 8 weeks
**Status:** ✅ 100% Complete
**Completion Date:** 2026-02-04

**Achievements:**
- NestJS 11 modular architecture (8 modules)
- Authentication (email/password, Google, Apple with auto-linking)
- AI features (LangChain, multi-provider, Langfuse tracing)
- Onboarding (anonymous chat, 10-turn max, 7-day TTL)
- Subscriptions (RevenueCat webhooks)
- Push notifications (Firebase FCM)
- Database (14 entities, RLS, 9 migrations)
- Swagger documentation

**Metrics:**
- ✅ 34 API endpoints
- ✅ 8 feature modules (138 TS files, ~8,330 LOC)
- ✅ 14 database entities with RLS
- ✅ 12 AI models supported
- ✅ Global auth guard + response wrapper
- ✅ Sentry + Langfuse integration

---

### Phase 2: Production Hardening 🔄 (In Progress)

**Duration:** 6 weeks
**Status:** 🔄 In Progress
**Progress:** 98% (HTTP logger, Sentry, language flags, prompts, translation, correction, vocabulary, premium features, grammar consolidation, Langfuse fixes, code cleanup, API standardization, scenario chat, vocabulary SRS, documentation done)
**Target Completion:** 2026-03-31

**Completed:**
- ✅ HTTP logger middleware (2026-03-07)
- ✅ Sentry error tracking for 5xx (2026-02-25)
- ✅ Language native/learning flags (2026-02-28)
- ✅ Prompt .md files copy to dist (2026-03-04)
- ✅ Onboarding config updates (2026-03-07)
- ✅ Translation service (word/sentence) (2026-03-08)
- ✅ Correction check endpoint (2026-03-08)
- ✅ Vocabulary entity with definition & examples (2026-03-08)
- ✅ Documentation update (api-docs, codebase-summary, code-standards, system-architecture, roadmap, changelog) (2026-03-11)
- ✅ WebhookEvent entity (DB-based webhook idempotency) (2026-03-14)
- ✅ POST /subscriptions/sync endpoint (RevenueCat sync) (2026-03-14)
- ✅ PremiumGuard & @RequirePremium() decorator (AI endpoint protection) (2026-03-14)
- ✅ All AI endpoints now require premium subscription (2026-03-14)
- ✅ Updated documentation for subscription payment features (2026-03-14)
- ✅ Removed /ai/grammar/check endpoint, consolidated into /ai/chat/correct (2026-03-24)
- ✅ Simplified correction prompt (ignore punctuation/capitalization, bold corrections) (2026-03-24)
- ✅ Fixed Langfuse output tracing (per-invocation handler with flushAsync) across all 3 LLM providers (2026-03-24)
- ✅ Made correction & translate endpoints public with @RequirePremium(false) (2026-03-24)
- ✅ Updated documentation for grammar consolidation & Langfuse fixes (2026-03-24)
- ✅ Removed unused AI endpoints: exercises/generate, pronunciation/assess, conversations CRUD (2026-03-28)
- ✅ Removed subscriptions/sync endpoint (redundant with RevenueCat webhooks) (2026-03-28)
- ✅ Removed entire notification module (FCM device management) (2026-03-28)
- ✅ Standardized API JSON keys to snake_case (all HTTP payloads) (2026-03-28)
- ✅ Updated all documentation for code cleanup & API standardization (2026-03-28)
- ✅ Scenario Chat API: POST /scenario/chat with AI roleplay, 12-turn cap, resumable conversations (2026-04-12)
- ✅ Database: Added ai_conversations.scenario_id FK + partial index (2026-04-12)
- ✅ ScenarioChatService + ScenarioAccessService (access control, language context) (2026-04-12)
- ✅ scenario-chat-prompt.json with scenario/learner/turn context injection (2026-04-12)
- ✅ 31 unit tests for scenario chat (service, access, controller, 100% coverage) (2026-04-12)
- ✅ Updated API docs, changelog, codebase-summary for scenario chat feature (2026-04-12)
- ✅ Vocabulary CRUD endpoints: GET /vocabulary (list + filter), GET /vocabulary/:id, DELETE /vocabulary/:id (2026-04-12)
- ✅ Leitner 5-box SRS review endpoints: POST /vocabulary/review/start, POST /vocabulary/review/:sessionId/rate, POST /vocabulary/review/:sessionId/complete (2026-04-12)
- ✅ Database: Added vocabulary SRS columns (box, due_at, last_reviewed_at, review_count, correct_count) + index (2026-04-12)
- ✅ VocabularyModule: CRUD service, review service, session store, Leitner algorithm (2026-04-12)
- ✅ Auto-save regression test: POST /ai/translate type=word does not reset SRS fields (2026-04-12)
- ✅ Full unit test coverage: 4 spec files, 100% branch coverage on Leitner transitions (2026-04-12)
- ✅ Updated API docs, changelog, codebase-summary, system-architecture for vocabulary/SRS feature (2026-04-12)
- ✅ Onboarding endpoint merge: collapsed POST /onboarding/start + /onboarding/chat into single unified endpoint (2026-04-14)
- ✅ OnboardingThrottlerGuard: custom throttler with conditional 5/hr (creation) and 30/hr (chat) limits (2026-04-14)
- ✅ All onboarding tests passing (25/25), backend test suite passing (284/284) (2026-04-14)
- ✅ Updated docs: api/onboarding-api.md, mobile-api-reference.md, codebase-summary, project-overview-pdr (2026-04-14)

**In Progress:**
| Feature | Priority | Status | Target Date |
|---------|----------|--------|-------------|
| Unit test coverage (>80%) | High | 🔄 30% | 2026-02-20 |
| E2E test suite | High | 📋 Planned | 2026-02-25 |
| Redis caching layer | High | 📋 Planned | 2026-03-01 |
| Per-user rate limiting | High | 📋 Planned | 2026-03-05 |
| Health check endpoints | Medium | 📋 Planned | 2026-03-08 |
| Database query optimization | High | 📋 Planned | 2026-03-12 |
| Response caching strategy | Medium | 📋 Planned | 2026-03-15 |
| API versioning | Low | 📋 Planned | 2026-03-18 |

**Success Metrics:**
- Test coverage >80%
- API response time p95 <500ms
- Zero N+1 query issues
- Health checks passing
- Cache hit rate >60%

---

### Phase 3: Content & Analytics 📋 (Planned)

**Duration:** 8 weeks
**Status:** 📋 Planned
**Target Start:** 2026-03-21
**Target Completion:** 2026-05-15

**Objectives:**
- Build content management system
- Implement analytics tracking
- Add admin dashboard
- Email notification service
- User progress tracking

**Deliverables:**

| Feature | Priority | Target Date |
|---------|----------|-------------|
| Lesson content CMS | High | 2026-04-05 |
| Exercise content management | High | 2026-04-10 |
| User progress tracking | High | 2026-04-15 |
| Learning analytics dashboard | Medium | 2026-04-20 |
| Email notification service | High | 2026-04-25 |
| Admin user management panel | Medium | 2026-05-01 |
| Content recommendation engine | Low | 2026-05-10 |
| Usage analytics API | Medium | 2026-05-15 |

**Success Metrics:**
- 50+ lessons in content library
- Progress tracking for all users
- Email delivery rate >95%
- Admin dashboard operational
- Analytics data retention 90d

---

### Phase 4: Scalability & Advanced Features 📋 (Planned)

**Duration:** 10 weeks
**Status:** 📋 Planned
**Target Start:** 2026-05-16
**Target Completion:** 2026-07-25

**Objectives:**
- Background job processing
- Real-time features
- Social features
- Advanced AI capabilities
- Multi-region deployment

**Deliverables:**

| Feature | Priority | Target Date |
|---------|----------|-------------|
| Bull/BullMQ job queue | High | 2026-05-25 |
| WebSocket real-time chat | Medium | 2026-06-01 |
| User friends system | Low | 2026-06-08 |
| Leaderboards & achievements | Low | 2026-06-15 |
| Gamification engine | Low | 2026-06-22 |
| Voice-based learning (STT/TTS) | Medium | 2026-06-29 |
| AI conversation memory | High | 2026-07-06 |
| Multi-region database | High | 2026-07-13 |
| Read replicas | Medium | 2026-07-20 |
| GraphQL API | Low | 2026-07-25 |

**Success Metrics:**
- Background jobs processing >1000/min
- WebSocket latency <100ms
- Multi-region latency <200ms
- GraphQL queries functional
- Social features engagement >30%

---

## Current Sprint (Week of 2026-03-10)

**Sprint Goal:** Complete Phase 2 hardening with testing and caching

**Completed:**
- ✅ Translation service (word/sentence with LangChain)
- ✅ Correction check endpoint with context awareness
- ✅ Vocabulary entity (definition, examples, pronunciation)
- ✅ Documentation update (all 7 docs aligned with actual codebase)

**In Progress:**
- 🔄 Unit test coverage for AI module
- 🔄 Integration tests for translation service

**Planned:**
- 📋 E2E test suite for new endpoints
- 📋 Redis caching layer for translations
- 📋 Per-user rate limiting

---

## Key Dependencies

### Phase 2 Dependencies
- ✅ Jest testing infrastructure
- ✅ Test database setup
- 📋 Mock AI provider responses
- 📋 Redis instance provisioned

### Phase 3 Dependencies
- 📋 Content schema finalized
- 📋 Email service provider selected (SendGrid/Mailgun)
- 📋 Admin UI framework chosen
- 📋 Analytics data model designed

### Phase 4 Dependencies
- 📋 Job queue infrastructure (Redis)
- 📋 WebSocket server configuration
- 📋 Multi-region strategy approved
- 📋 GraphQL schema design

## Risk Management

### Active Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| AI provider rate limits | High | Medium | Implement caching, multiple providers, fallbacks |
| Test coverage gaps | Medium | High | Automated coverage reports, CI integration |
| Database connection exhaustion | High | Low | Connection pooling, query optimization |
| Webhook processing delays | Medium | Medium | Async processing, job queue (Phase 4) |
| Third-party service outages | High | Low | Multi-provider fallbacks, circuit breakers |

### Resolved Risks

| Risk | Resolution | Date Resolved |
|------|-----------|---------------|
| Authentication security | Implemented bcrypt + JWT + RLS | 2026-01-21 |
| OAuth duplicate accounts | Auto-linking via email match | 2026-02-24 |
| Webhook authorization | Bearer token validation (timing-safe) | 2026-02-01 |
| API documentation gaps | Swagger auto-generation | 2026-02-04 |

---

## Success Criteria

### Overall Project Success
- ✅ MVP deployed and functional
- ✅ 8 modules implemented
- 📋 Production-grade test coverage (>80%)
- 📋 API response time <500ms (p95)
- 📋 99.9% uptime SLA
- 📋 Zero critical security vulnerabilities

### Phase 1 Success (Complete)
- ✅ 30+ API endpoints operational
- ✅ 8 feature modules implemented
- ✅ 14 database entities with RLS
- ✅ 10+ AI models supported
- ✅ Zero critical security vulnerabilities

### Phase 2 Success (In Progress)
- Test coverage >80%
- Redis caching operational
- Health checks passing
- Rate limiting enforced
- API documentation complete

### Phase 3 Success
- Content CMS operational
- Analytics tracking implemented
- Email notifications sent
- Admin dashboard accessible
- User progress tracked

### Phase 4 Success
- Background jobs processing
- WebSocket chat functional
- Multi-region deployment
- Social features live
- GraphQL API available

---

## Version History

| Version | Release Date | Status | Key Features |
|---------|-------------|--------|--------------|
| 1.2.0 | 2026-03-09 | Current | Translation, correction, vocabulary, documentation |
| 1.1.0 | 2026-03-08 | Stable | HTTP logger, Sentry, language flags, prompt assets |
| 1.0.0 | 2026-02-04 | Stable | MVP: auth, AI, onboarding, subscriptions, notifications |

---

## Timeline Summary

```
Phase 1: MVP Foundation      2026-01-01 ========> 2026-02-04 ✅
Phase 2: Production Hardening   2026-02-04 ===>   2026-03-20 🔄
Phase 3: Content & Analytics       2026-03-21 => 2026-05-15
Phase 4: Scalability & Advanced       2026-05-16 => 2026-07-25
```

---

## Contributing

Development follows agile methodology with 2-week sprints. See [`code-standards.md`](./code-standards.md) for coding guidelines and [`system-architecture.md`](./system-architecture.md) for architectural patterns.

## Resources

- **Documentation:** `./docs/`
- **Issue Tracking:** GitHub Issues
- **Project Board:** GitHub Projects
- **API Docs:** `/api/docs` (Swagger)
- **Architecture:** [`system-architecture.md`](./system-architecture.md)
- **Code Standards:** [`code-standards.md`](./code-standards.md)
- **Codebase Summary:** [`codebase-summary.md`](./codebase-summary.md)
