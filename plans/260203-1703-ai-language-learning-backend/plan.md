---
title: "AI Language Learning NestJS Backend"
description: "Full-stack NestJS backend with LangChain AI, Supabase, RevenueCat subscriptions"
status: pending
priority: P1
effort: 32h
branch: main
tags: [nestjs, langchain, supabase, ai, language-learning]
created: 2026-02-03
---

# AI Language Learning Backend Implementation Plan

## Overview

NestJS 11 backend for AI-powered language learning app supporting multiple languages, LangChain agents with tiered LLM routing, Supabase PostgreSQL, and Railway deployment.

**Target Scale:** 1,000-10,000 users | **Clients:** Mobile (Flutter/React Native)

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Audio Transcription | OpenAI Whisper API | Same provider as LLM, simplified billing |
| OAuth Priority | Google first, Apple second | Apple required for iOS App Store |
| Content Management | Seed scripts for MVP | Defer admin panel to Phase 2 |
| LLM Strategy | Tiered (4o + 4o-mini) | Balance quality/cost |

## Phase Summary

| Phase | Description | Effort | Status |
|-------|-------------|--------|--------|
| [Phase 01](./phase-01-project-setup.md) | Project Setup & Configuration | 4h | completed |
| [Phase 02](./phase-02-database-supabase.md) | Database & Supabase Setup | 4h | pending |
| [Phase 03](./phase-03-auth-module.md) | Auth Module (JWT + OAuth) | 5h | pending |
| [Phase 04](./phase-04-core-modules.md) | Core Modules (User, Language, Lesson, Progress) | 6h | pending |
| [Phase 05](./phase-05-ai-module.md) | AI Module with LangChain | 6h | pending |
| [Phase 06](./phase-06-subscription-notification.md) | Subscription & Notification | 4h | pending |
| [Phase 07](./phase-07-monitoring-deployment.md) | Monitoring & Deployment | 3h | pending |

## Dependencies

- Supabase project (database + storage)
- OpenAI API key
- Langfuse account (free tier)
- RevenueCat account
- Firebase project (FCM)
- Sentry account
- Railway account (dev + prod)

## Reference Documents

- [NestJS + LangChain Research](./research/researcher-01-nestjs-langchain.md)
- [Supabase Integration Research](./research/researcher-02-supabase-integrations.md)
- [Architecture Brainstorm](../reports/brainstorm-260203-1626-ai-language-learning-backend-architecture.md)

## Success Criteria

- All 7 phases completed with passing tests
- API response time <200ms (non-AI), <3s (AI chat)
- Swagger docs accessible at /api/docs
- Health checks passing on Railway
- >80% test coverage on critical paths

---

## Validation Log

### Session 1 — 2026-02-03
**Trigger:** Initial plan creation validation
**Questions asked:** 8

#### Questions & Answers

1. **[Architecture]** The plan uses TypeORM for database. Which ORM do you prefer for this project?
   - Options: TypeORM (Recommended) | Drizzle ORM | Prisma
   - **Answer:** TypeORM (Recommended)
   - **Rationale:** Mature ecosystem, good NestJS integration, works with existing plan

2. **[Scope]** Which languages should be seeded initially? (Select 2-3)
   - Options: English (en) | Vietnamese (vi) | Japanese (ja) | Korean (ko)
   - **Answer:** English (en), Vietnamese (vi)
   - **Rationale:** Focus on primary target market, can add more languages later

3. **[Architecture]** What API prefix convention should be used?
   - Options: /api/v1 (Recommended) | /api | No prefix
   - **Answer:** /api
   - **Rationale:** Simpler for MVP, can add version headers later if needed

4. **[Architecture]** RevenueCat webhooks require reliable processing. Should we add a job queue?
   - Options: No queue (MVP) | Bull/Redis queue (Recommended) | Cloud queue (SQS/Pub/Sub)
   - **Answer:** Bull/Redis queue (Recommended)
   - **Rationale:** Ensures reliable webhook processing, handles Railway instance restarts

5. **[Tradeoff]** Should AI prompts (.md files) support hot-reload without restart?
   - Options: No hot-reload (simpler) | Dev-only hot-reload (Recommended) | Full hot-reload
   - **Answer:** Dev-only hot-reload (Recommended)
   - **Rationale:** Better DX during development, no overhead in production

6. **[Architecture]** Where should rate limit state be stored for AI endpoints?
   - Options: In-memory (MVP) | Redis (Recommended) | Database
   - **Answer:** Redis (Recommended)
   - **Rationale:** Scales across Railway instances, consistent rate limiting

7. **[Scope]** What level of test coverage should we target for Phase 1?
   - Options: Unit tests only (MVP) | Unit + E2E (Recommended) | Full test suite
   - **Answer:** Unit tests only (MVP)
   - **Rationale:** Focus on core functionality first, add E2E in Phase 2

8. **[Architecture]** Should we use Supabase Auth or build custom auth in NestJS?
   - Options: Supabase Auth | Custom NestJS Auth (Recommended)
   - **Answer:** Custom NestJS Auth (Recommended)
   - **Rationale:** More control over auth flow, mobile OAuth handling flexibility

#### Confirmed Decisions
- **ORM:** TypeORM — mature, works with plan
- **Initial Languages:** English + Vietnamese — target market focus
- **API Prefix:** /api — simplicity for MVP
- **Job Queue:** Bull/Redis — reliability for webhooks
- **Prompt Hot-Reload:** Dev-only — better DX without production overhead
- **Rate Limiting:** Redis — scalable across instances
- **Testing:** Unit tests only — MVP scope
- **Auth:** Custom NestJS — more control

#### Action Items
- [ ] Add Redis dependency to Phase 01 for rate limiting + job queues
- [ ] Add Bull queue setup to Phase 06 for webhook processing
- [ ] Update language seed to include only English + Vietnamese
- [ ] Configure API prefix as /api in main.ts
- [ ] Add file watcher for prompts in dev mode only

#### Impact on Phases
- **Phase 01:** Add Redis client setup (@nestjs/cache-manager, ioredis)
- **Phase 02:** Update language seed: only en + vi
- **Phase 05:** Add dev-only file watcher for prompts, Redis-based throttling
- **Phase 06:** Replace setImmediate with Bull queue for webhook processing
