# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Language Learning Backend - A NestJS API for a multi-language learning app with AI-powered features using LangChain and Langfuse monitoring. Uses Supabase/PostgreSQL for storage and TypeORM for database access.

## Commands

```bash
# Development
npm run start:dev          # Start with hot reload
npm run build              # Build for production
npm run start:prod         # Run production build

# Testing
npm test                   # Run all tests
npm run test:watch         # Watch mode
npm run test:cov           # Coverage report
npm run test:e2e           # E2E tests

# Linting/Formatting
npm run lint               # ESLint with auto-fix
npm run format             # Prettier format

# Database Migrations
npm run migration:run      # Run pending migrations
npm run migration:revert   # Revert last migration
npm run migration:generate # Generate migration from entities
```

## Architecture

### Module Structure
All feature modules follow NestJS modular architecture in `src/modules/`:

- **auth/** - JWT authentication, Google/Apple OAuth strategies, guards
- **ai/** - LangChain-based AI features (chat, exercises, grammar, pronunciation)
- **user/** - User profile management
- **language/** - User language preferences and progress
- **subscription/** - RevenueCat subscription handling with webhooks
- **notification/** - Firebase push notifications

### Core Components

**Database Layer** (`src/database/`):
- TypeORM entities in `entities/` - User, Language, Lesson, Exercise, Subscription, etc.
- `typeorm-data-source.ts` - Migration data source
- `supabase-storage.service.ts` - File storage abstraction

**AI Module** (`src/modules/ai/`):
- Multi-provider LLM support via `providers/` (OpenAI, Anthropic, Google)
- `unified-llm.service.ts` - Provider abstraction layer
- `learning-agent.service.ts` - Main AI tutor logic
- Prompts stored as markdown in `prompts/`
- Langfuse integration for tracing in `langfuse-tracing.service.ts`

**Common Utilities** (`src/common/`):
- `ResponseTransformInterceptor` - Wraps responses in `{code, message, data}` format
- `AllExceptionsFilter` - Consistent error handling, never exposes raw exceptions

### Path Aliases
Configured in `tsconfig.json`:
- `@/*` → `src/*`
- `@common/*` → `src/common/*`
- `@config/*` → `src/config/*`

## API Response Format

All responses follow this structure (never throw raw exceptions to frontend):
```json
{
  "code": 1,
  "message": "Success message",
  "data": {}
}
```

## Environment

Copy `.env.example` to `.env`. Key services:
- Supabase: Database + file storage
- LLM providers: OpenAI, Anthropic, Google AI (any or all)
- Langfuse: AI tracing/monitoring
- Firebase: Push notifications
- RevenueCat: In-app subscriptions

## Swagger

Available at `/api/docs` in non-production environments.

## Documentation

All docs in `docs/` directory:
- `project-overview-pdr.md` - Product requirements, features
- `codebase-summary.md` - Module structure, entities
- `code-standards.md` - Coding patterns, validation
- `system-architecture.md` - Architecture diagrams, data flow
- `api-documentation.md` - API endpoints reference
- `project-roadmap.md` - Development phases, milestones

## Database Entities

13 TypeORM entities in `src/database/entities/`:
- **Core**: User, Language, UserLanguage
- **Content**: Lesson, Exercise
- **Progress**: UserProgress, UserExerciseAttempt
- **AI**: AiConversation, AiConversationMessage
- **Infrastructure**: Subscription, DeviceToken, RefreshToken

## Key Patterns

- **Global JWT Guard**: All routes protected by default; use `@Public()` decorator to bypass
- **Response Wrapper**: All responses wrapped in `{code: 1, message, data}` via interceptor
- **Error Handling**: `AllExceptionsFilter` catches all errors, never exposes raw exceptions
- **Rate Limiting**: AI endpoints: 20 req/min, 100 req/hour per user
- **RLS Policies**: Database-level row security for user data isolation

## Rules

- Never throw raw exceptions to frontend
- Use BaseResponseDto for all responses
- Follow DRY, KISS, YAGNI principles
- Keep files under 200 lines when possible

## Task Completion Guidelines

**CRITICAL: Always complete tasks end-to-end. Do not leave implementations partial or unclear.**

### Before Starting Any Task
1. List ALL deliverables upfront (files to create/modify, tests, docs)
2. Define explicit success criteria
3. State what "done" looks like

### During Implementation
- Check off each deliverable as completed
- Do not stop until all items are verified done
- If blocked, explicitly state what's blocking and what remains

### Database Changes (Migrations)
Always show complete implementation including:
1. Migration file with proper up/down methods
2. Entity/type updates
3. DTO modifications
4. API endpoint changes
5. Example API request/response

### Documentation Tasks
- Output complete file content using Write tool
- Prefer writing actual content over explaining what to write
- Verify all code references in docs actually exist

### API Modifications
Complete checklist for every API change:
- [ ] Database query/entity updated
- [ ] TypeScript types/DTOs updated
- [ ] Controller endpoint modified
- [ ] Tests added/updated
- [ ] Swagger docs updated
- [ ] Example curl command provided

### Session End Protocol
Before ending any session, confirm:
1. All listed deliverables are complete
2. Code compiles without errors (`npm run build`)
3. Tests pass (`npm test`)
4. Summary of what was done vs what remains (if any)