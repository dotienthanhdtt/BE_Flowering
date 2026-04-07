# Backend Scout Report: NestJS at /Users/tienthanh/Documents/new_flowering/be_flowering

## 1. TypeORM Entities (src/database/entities/)

### Core Learning Entities
| Entity | Key Fields | Notes |
|--------|-----------|-------|
| **Lesson** | id, languageId, title, description, difficulty (enum), orderIndex, isPremium, isActive, createdAt, updatedAt | FK: Language |
| **Exercise** | id, lessonId, type (enum: MULTIPLE_CHOICE, FILL_IN_BLANK, LISTENING, SPEAKING, TRANSLATION, MATCHING), question, correctAnswer (JSONB), options (JSONB), audioUrl, orderIndex, points | FK: Lesson (CASCADE) |
| **UserProgress** | id, userId, lessonId, status (enum: NOT_STARTED, IN_PROGRESS, COMPLETED), scoreEarned, exercisesCompleted, exercisesTotal, completedAt | FK: User, Lesson (both CASCADE); Unique(userId, lessonId) |
| **UserExerciseAttempt** | id, userId, exerciseId, userAnswer (JSONB), isCorrect, pointsEarned, timeSpentSeconds | FK: User, Exercise (both CASCADE) |

### User & Auth Entities
| Entity | Key Fields | Notes |
|--------|-----------|-------|
| **User** | id, email (unique), passwordHash, authProvider, providerId, googleProviderId, appleProviderId, firebaseUid (unique), emailVerified, displayName, avatarUrl, phoneNumber, nativeLanguageId | FK: Language (native) |
| **RefreshToken** | id (UUID), tokenHash, userId, expiresAt, revoked | FK: User (CASCADE) |
| **PasswordReset** | id, email, otpHash, resetTokenHash, attempts, expiresAt, resetTokenExpiresAt, used | Index on (email, createdAt) |

### Language & User Language
| Entity | Key Fields | Notes |
|--------|-----------|-------|
| **Language** | id, code (unique, 10 char), name, nativeName, isActive, isNativeAvailable, isLearningAvailable, flagUrl | No FK |
| **UserLanguage** | id, userId, languageId, proficiencyLevel (enum: BEGINNER, ELEMENTARY, INTERMEDIATE, UPPER_INTERMEDIATE, ADVANCED), isActive | FK: User, Language (both CASCADE) |

### Subscription & AI
| Entity | Key Fields | Notes |
|--------|-----------|-------|
| **Subscription** | id, userId (unique), plan (enum: FREE, MONTHLY, YEARLY, LIFETIME), status (enum: ACTIVE, EXPIRED, CANCELLED, TRIAL), revenuecatId, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd | FK: User (CASCADE) |
| **AiConversation** | id, userId (nullable), languageId (nullable), type (enum: ANONYMOUS, AUTHENTICATED), expiresAt, title, topic, messageCount, metadata (JSONB) | FK: User, Language (nullable) |
| **AiConversationMessage** | id, conversationId, role (enum: USER, ASSISTANT, SYSTEM), content, audioUrl, metadata (JSONB), translatedContent, translatedLang | FK: AiConversation (CASCADE) |

### Support Entities
| Entity | Key Fields | Notes |
|--------|-----------|-------|
| **Vocabulary** | id, userId, word, translation, sourceLang, targetLang, partOfSpeech, pronunciation, definition, examples (JSONB array) | FK: User (CASCADE); Unique(userId, word, sourceLang, targetLang) |
| **DeviceToken** | id, userId, fcmToken (unique), platform (enum: IOS, ANDROID, WEB), deviceName, isActive | FK: User (CASCADE) |
| **WebhookEvent** | eventId (PK), eventType, processedAt | Idempotency table |

**Total: 15 entities registered in database.module.ts**

---

## 2. Lesson/Scenario Related Code

### Current Status
- **NO scenario entity** exists
- **Lesson & Exercise entities exist** but:
  - No dedicated lesson service/controller module
  - Not exposed via any REST endpoint
  - Only referenced as part of core schema
  - Ready for integration

### What Exists
- Lesson <-> Exercise relationship (1:N, CASCADE delete)
- Exercise types: MULTIPLE_CHOICE, FILL_IN_BLANK, LISTENING, SPEAKING, TRANSLATION, MATCHING
- UserProgress tracks lesson completion status
- UserExerciseAttempt tracks individual exercise attempts with scoring

### What's Missing
- `/lessons` endpoint to list/get lessons
- `/lessons/:id/exercises` endpoint
- Lesson service methods
- Lesson DTOs

---

## 3. Database Module Registration

**File:** `src/database/database.module.ts`

```typescript
const entities = [
  Language,
  User,
  UserLanguage,
  Lesson,
  Exercise,
  UserProgress,
  UserExerciseAttempt,
  Subscription,
  AiConversation,
  AiConversationMessage,
  DeviceToken,
  RefreshToken,
  PasswordReset,
  Vocabulary,
  WebhookEvent,
];
```

**DB Config:**
- Type: PostgreSQL
- URL via ConfigService
- SSL enabled (rejectUnauthorized: false)
- Connection pool: max=10, min=2, idleTimeoutMillis=30000
- Synchronize: false (migration-based)
- Logging: false

---

## 4. Existing API Endpoints

### Health & App
- `GET /` → Health check (public)

### Auth Module
- Auth endpoints (not detailed in scope)

### Languages (`/languages`)
- `GET /` → List languages (public, optional filter by type)
- `GET /user` → Get user's learning languages
- `POST /user` → Add language to learning list
- `PATCH /user/native` → Set native language
- `PATCH /user/:languageId` → Update proficiency level
- `DELETE /user/:languageId` → Remove language

### Users (`/users`)
- `GET /me` → Get current user profile
- `PATCH /me` → Update user profile

### Onboarding (`/onboarding`)
- `POST /start` → Start anonymous onboarding session
- `POST /chat` → Send onboarding chat message
- `POST /complete` → Extract user profile from conversation

### Subscription (`/subscription`)
- Subscription management endpoints
- Revenue Cat webhook endpoint

### AI Module (`/ai`)
- AI conversation endpoints (not detailed in scope)

**⚠️ NO lesson, exercise, or home screen endpoints exist**

---

## 5. Migration Files

| Timestamp | Name | Purpose |
|-----------|------|---------|
| 1706976000000 | initial-schema | Creates all base tables (users, languages, lessons, exercises, etc.) |
| 1706976100000 | rls-policies | Row-level security policies |
| 1738678400000 | add-flag-url-to-languages | Adds flagUrl column to languages |
| 1738678500000 | create-refresh-tokens-table | RefreshToken table |
| 1740000000000 | add-onboarding-to-ai-conversations | Onboarding fields to ai_conversations |
| 1740100000000 | auth-improvements-provider-columns | Additional auth provider columns |
| 1740200000000 | add-native-learning-flags-to-languages | isNativeAvailable, isLearningAvailable |
| 1740300000000 | create-vocabulary-and-add-translation-columns | Vocabulary table + translation columns |
| 1740400000000 | add-definition-examples-to-vocabulary | definition, examples (JSONB) columns |
| 1740500000000 | create-webhook-events-table | WebhookEvent table |
| 1772277787300 | create-password-resets-table | PasswordReset table |
| 1772277787400 | drop-session-token-from-ai-conversations | Cleanup |
| 1775300000000 | add-firebase-uid-to-users | Firebase UID support |
| 1775400000000 | add-email-verified-to-users | Email verification flag |

**Total: 14 migrations** | DB evolution shows core feature → payment → onboarding → vocabulary progression

---

## 6. Modules Structure (src/modules/)

| Module | Files | Controllers | Services |
|--------|-------|-------------|----------|
| **ai** | ai.controller.ts, ai.module.ts, services/, guards/, providers/, prompts/, dto/ | ai.controller | learning-agent, translation, unified-llm, langfuse-tracing, prompt-loader |
| **auth** | auth.controller.ts, auth.service.ts, auth.module.ts, strategies/, guards/, decorators/, dto/ | auth.controller | auth.service |
| **user** | user.controller.ts, user.service.ts, user.module.ts, dto/ | user.controller | user.service |
| **language** | language.controller.ts, language.service.ts, language.module.ts, dto/ | language.controller | language.service |
| **subscription** | subscription.controller.ts, subscription.service.ts, subscription.module.ts, webhooks/, dto/ | subscription.controller, revenuecat-webhook.controller | subscription.service |
| **onboarding** | onboarding.controller.ts, onboarding.service.ts, onboarding.module.ts, onboarding.config.ts, dto/ | onboarding.controller | onboarding.service |
| **email** | email.module.ts, email.service.ts | — | email.service |

**Registered in AppModule:** AuthModule, AiModule, UserModule, LanguageModule, SubscriptionModule, OnboardingModule

**⚠️ NO dedicated LessonModule or ScenarioModule exists**

---

## Summary

**Inventory:**
- ✓ 15 TypeORM entities
- ✓ Lesson + Exercise schema (no Scenario)
- ✓ 6 main modules + email
- ✓ 14 migrations
- ✓ ~8 public + authenticated endpoints (non-lesson)
- ✗ Zero lesson/exercise API endpoints
- ✗ Zero home screen dashboard endpoints

**Ready for:** Lesson & Exercise module creation

---

*Report generated: 2026-04-06*
