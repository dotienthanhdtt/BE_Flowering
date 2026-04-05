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

- **auth/** - JWT authentication, Google idToken POST + Apple OAuth, composite refresh tokens, account auto-linking
- **ai/** - LangChain-based AI features (chat, exercises, grammar, pronunciation)
- **user/** - User profile management
- **language/** - User language preferences and progress
- **subscription/** - RevenueCat subscription handling with webhooks
- **notification/** - Firebase push notifications
- **onboarding/** - Anonymous onboarding chat with session-based AI conversations (no auth required)

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
- **Composite Refresh Tokens**: Stored hashed in DB with device fingerprint; 90-day expiry
- **Firebase Auth**: POST `/auth/firebase` accepts Firebase ID token (auto-detects Google/Apple provider)
- **Account Auto-linking**: Google/Apple login auto-links to existing email account
- **Anonymous Onboarding**: Session-based chat at `/onboarding/*`; no JWT needed; state stored in-memory per `sessionId`

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
1. Migration file for Supbase DB with proper up/down methods
2. Entity/type updates
3. DTO modifications
4. API endpoint changes
5. Example API request/responsafe

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

## Railway Deployment Rules

**CRITICAL: Prevent Railway build failures**

### Dependency Management
- **Always install new packages with `npm install <package>`** before using them in code — never `import` a package that isn't in `package.json`.
- **`@types/*` packages go in `devDependencies`** (auto-placed by `npm install --save-dev`). The runtime package itself must be in `dependencies`.
- **Before committing any new `import` statement**, verify the package exists in the `dependencies` section of `package.json`:
  ```bash
  grep '"<package-name>"' package.json
  ```
- **After adding a new module/service that uses external npm packages**, run `npm run build` locally to confirm no `TS2307: Cannot find module` errors before pushing.

> **Root cause of 2026-02-28 Railway failure:** `nodemailer` was used in `email.service.ts` but never added to `package.json`. Railway's `npm ci` + `nest build` failed with `TS2307: Cannot find module 'nodemailer'`. Fix: `npm install nodemailer`.

### Entity Registration
- **When creating a new TypeORM entity**, you MUST register it in **both** places:
  1. `src/database/database.module.ts` — add to the global `entities` array (required for `DataSource` metadata, `createQueryBuilder`, raw queries)
  2. `src/modules/<feature>/<feature>.module.ts` — add to `TypeOrmModule.forFeature([...])` (required for `@InjectRepository()` in that module)
- **Missing either registration causes runtime errors** (`EntityMetadataNotFoundError` or `No repository was found`). These won't surface at build time — only at runtime when the entity is first used.

> **Root cause of 2026-03-08 runtime 500:** `Vocabulary` entity was added to `AiModule`'s `TypeOrmModule.forFeature()` but not to `database.module.ts` global entities array. `createQueryBuilder().insert().into(Vocabulary)` hit the DataSource directly and threw `EntityMetadataNotFoundError`. Fix: add entity to both locations.

### External Service Initialization
- **Services depending on external credentials (Firebase, SMTP, etc.) must NEVER crash the app on init failure.** Use try-catch in `onModuleInit()`, log a warning, and degrade gracefully — the specific endpoints return proper errors, but the rest of the app stays up.
- **Before deploying new external service integrations**, verify Railway env vars contain real values (not `.env.example` placeholders like `your-xxx`). Placeholder values pass null-checks but fail at runtime parsing.
- **Always test with `NODE_ENV=production` locally** when adding services that read env vars — catches missing/malformed config before Railway deploy.

> **Root cause of 2026-04-04 Railway crash:** `FirebaseAdminService.onModuleInit()` threw on invalid `FIREBASE_PRIVATE_KEY` (placeholder value from `.env.example`), crashing the entire NestJS app. Fix: graceful init with try-catch + `initialized` flag.