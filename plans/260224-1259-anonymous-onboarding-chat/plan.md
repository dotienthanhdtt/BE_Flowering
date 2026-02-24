---
title: "Anonymous Onboarding Chat"
description: "Pre-login AI chat for onboarding data collection"
status: complete
priority: P1
effort: 6h
branch: dev
tags: [onboarding, ai, anonymous, chat]
created: 2026-02-24
---

# Anonymous Onboarding Chat

## Summary

Allow anonymous mobile users to chat with AI pre-login. Collects name, age, region, learning motivation through natural conversation. Links to user account after registration.

## Architecture Decision

**Approach A (selected):** Make `user_id` nullable on `ai_conversations`, add `session_token`, `type`, `expires_at` columns. Reuse existing message table. KISS/DRY winner.

## Validated Decisions (2026-02-24)
- **LLM service:** UnifiedLLMService directly (not LearningAgentService)
- **Extraction:** Second LLM call with dedicated extraction prompt
- **RLS:** Service role key bypasses RLS — no policy changes needed
- **OAuth linking:** All auth methods supported (email, Apple, Google via state param)

## Phases

| # | Phase | Status | Effort | File |
|---|-------|--------|--------|------|
| 1 | Database Migration | complete | 1h | [phase-01](./phase-01-database-migration.md) |
| 2 | Module Setup | complete | 0.5h | [phase-02](./phase-02-onboarding-module-setup.md) |
| 3 | Service & Controller | complete | 2h | [phase-03](./phase-03-onboarding-service-and-controller.md) |
| 4 | AI Prompt | complete | 0.5h | [phase-04](./phase-04-onboarding-prompt.md) |
| 5 | Auth Linking | complete | 1h | [phase-05](./phase-05-auth-linking.md) |
| 6 | Testing | complete | 1h | [phase-06](./phase-06-testing.md) |

## Dependencies

- Existing `AiConversation` + `AiConversationMessage` entities
- `UnifiedLLMService` for LLM calls
- `PromptLoaderService` for prompt loading
- `LangfuseService` for tracing
- `AuthService` for registration linking

## Key Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/onboarding/start` | @Public() | Create session |
| POST | `/onboarding/chat` | @Public() | Chat with AI |
| POST | `/onboarding/complete` | @Public() | Extract structured data |

## New Files

```
src/modules/onboarding/
  onboarding.module.ts
  onboarding.controller.ts
  onboarding.service.ts
  onboarding.config.ts
  dto/
    start-onboarding.dto.ts
    onboarding-chat.dto.ts
    onboarding-complete.dto.ts
src/modules/ai/prompts/
  onboarding-chat-prompt.md
  onboarding-extraction-prompt.md
src/database/migrations/
  {timestamp}-add-onboarding-to-ai-conversations.ts
```

## Modified Files

- `src/database/entities/ai-conversation.entity.ts` (nullable user_id, new columns)
- `src/database/entities/index.ts` (no change needed - entity already exported)
- `src/app.module.ts` (add OnboardingModule)
- `src/modules/auth/auth.service.ts` (link session after register)
- `src/modules/auth/auth.module.ts` (import AiConversation repo)
- `src/modules/auth/dto/register.dto.ts` (add optional session_token)
