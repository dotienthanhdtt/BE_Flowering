# Flowering — Onboarding Backend Requirements

**Version:** 1.0
**Last Updated:** February 28, 2026
**Status:** Draft — Pending Backend Team Review

---

## Table of Contents

1. [Overview](#1-overview)
2. [Data Models](#2-data-models)
3. [API Endpoints](#3-api-endpoints)
4. [Business Logic Rules](#4-business-logic-rules)
5. [Language System Logic](#5-language-system-logic)
6. [Content Generation & Caching](#6-content-generation--caching)
7. [Edge Cases & Error Handling](#7-edge-cases--error-handling)
8. [Analytics Events](#8-analytics-events)
9. [Open Questions](#9-open-questions)

---

## 1. Overview

### 1.1 Purpose

This document defines all backend requirements for the Flowering app onboarding flow. The onboarding converts a new user from app install to first paid interaction through a 5-step funnel:

**Splash → Welcome Screens → Language Selection → Anonymous AI Chat → Login → First Scenario → Paywall**

### 1.2 Scope

This document covers:

- All API endpoints required for the onboarding flow
- Data models for user profiles, language settings, onboarding state, chat sessions, and generated content
- Business logic rules including language validation, content generation, and caching
- Edge cases including offline behavior, mid-flow abandonment, and error recovery

This document does NOT cover:

- Post-onboarding features (home screen, daily lessons, progress tracking)
- Payment processing implementation (covered in separate Paywall Requirements doc)
- AI prompt engineering for chat conversations (covered in separate AI Chat Spec doc)
- Frontend UI/UX specifications (covered in separate Design Spec doc)

### 1.3 Architecture Context

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│  Mobile App  │────▶│  Backend API │────▶│  AI Service (LLM)    │
│  (iOS/Android)│◀────│  (REST)      │◀────│  Content Generation  │
└──────────────┘     └──────┬───────┘     └──────────────────────┘
                           │
                    ┌──────▼───────┐
                    │   Database   │
                    │  + Cache     │
                    └──────────────┘
```

### 1.4 Supported Languages (V1)

| Language | Code | i18n Support | Content Generation | Available As Native | Available As Learning |
|----------|------|:---:|:---:|:---:|:---:|
| Vietnamese | `vi` | ✅ | ✅ | ✅ | ✅ |
| English | `en` | ✅ | ✅ | ✅ | ✅ |
| All others | — | ❌ | ❌ | ❌ (forced to `en`) | ❌ |

---

## 2. Data Models

### 2.1 User

```
User {
  id                    : UUID (PK)
  email                 : String (nullable, unique)
  auth_provider         : Enum [apple, google, email]
  auth_provider_id      : String (nullable)
  password_hash         : String (nullable, only for email auth)
  
  app_language          : String (ISO 639-1, default "en")
  native_language       : String (ISO 639-1, nullable)
  learning_language     : String (ISO 639-1, nullable)
  
  onboarding_status     : Enum [not_started, welcome_completed, native_lang_selected, 
                                learning_lang_selected, chat_completed, 
                                scenarios_generated, logged_in, first_scenario_completed,
                                paywall_shown, onboarding_completed]
  onboarding_step       : Integer (0-7, tracks last completed step)
  
  subscription_status   : Enum [free, trial, premium_monthly, premium_annual]
  subscription_expires  : Timestamp (nullable)
  
  created_at            : Timestamp
  updated_at            : Timestamp
  last_active_at        : Timestamp
}
```

### 2.2 Anonymous Session

Tracks users before login. Merges into User record on authentication.

```
AnonymousSession {
  id                    : UUID (PK)
  device_id             : String (unique device fingerprint)
  device_language       : String (ISO 639-1)
  
  app_language          : String (ISO 639-1, default "en")
  native_language       : String (ISO 639-1, nullable)
  learning_language     : String (ISO 639-1, nullable)
  
  onboarding_status     : Enum (same as User)
  onboarding_step       : Integer (0-7)
  
  session_token         : String (unique)
  
  created_at            : Timestamp
  updated_at            : Timestamp
  expires_at            : Timestamp (30 days from creation)
  merged_to_user_id     : UUID (nullable, FK → User, set on login)
}
```

### 2.3 Onboarding Chat Session

```
OnboardingChatSession {
  id                    : UUID (PK)
  session_owner_type    : Enum [anonymous, user]
  session_owner_id      : UUID (FK → AnonymousSession or User)
  
  native_language       : String (ISO 639-1)
  learning_language     : String (ISO 639-1)
  
  status                : Enum [active, completed, abandoned, expired]
  
  collected_data        : JSON {
    goal                : String (nullable) — e.g., "career", "travel", "culture"
    current_level       : String (nullable) — e.g., "beginner", "intermediate", "advanced"
    interests           : Array<String> (nullable) — e.g., ["technology", "business", "travel"]
    daily_time          : String (nullable) — e.g., "5min", "10min", "15min", "30min"
  }
  
  message_count         : Integer
  is_ended              : Boolean (default false)
  
  created_at            : Timestamp
  updated_at            : Timestamp
}
```

### 2.4 Chat Message

```
ChatMessage {
  id                    : UUID (PK)
  chat_session_id       : UUID (FK → OnboardingChatSession)
  
  role                  : Enum [system, assistant, user]
  content               : Text
  message_index         : Integer (ordered sequence)
  
  metadata              : JSON (nullable) {
    quick_replies       : Array<String> (nullable) — suggested response buttons
    data_collected_key  : String (nullable) — which collected_data field this message filled
    data_collected_value: String (nullable) — the extracted value
  }
  
  created_at            : Timestamp
}
```

### 2.5 Generated Scenario

```
GeneratedScenario {
  id                    : UUID (PK)
  owner_type            : Enum [anonymous, user]
  owner_id              : UUID (FK → AnonymousSession or User)
  
  chat_session_id       : UUID (FK → OnboardingChatSession)
  
  native_language       : String (ISO 639-1)
  learning_language     : String (ISO 639-1)
  
  title                 : String — e.g., "Job Interview at a Tech Company"
  description           : Text — brief scenario description
  difficulty            : Enum [beginner, intermediate, advanced]
  category              : String — e.g., "career", "travel", "social"
  
  scenario_data         : JSON {
    context             : Text — scenario setup
    ai_role             : String — who the AI plays
    user_role           : String — who the user plays
    objectives          : Array<String> — what user should accomplish
    key_vocabulary      : Array<String> — target words/phrases
    suggested_duration  : Integer — minutes
  }
  
  sort_order            : Integer (1-5)
  is_unlocked           : Boolean (default false)
  is_completed          : Boolean (default false)
  
  created_at            : Timestamp
}
```

### 2.6 Content Cache

```
ContentCache {
  id                    : UUID (PK)
  user_id               : UUID (FK → User)
  
  cache_key             : String (unique per user) — format: "{native}_{learning}"
  
  native_language       : String (ISO 639-1)
  learning_language     : String (ISO 639-1)
  
  content_type          : Enum [scenarios, vocabulary, grammar_tips, lesson_content]
  content_data          : JSON — the cached content
  
  is_active             : Boolean — is this the current active language pair
  
  created_at            : Timestamp
  updated_at            : Timestamp
}
```

### 2.7 Language Waitlist

Captures interest for unsupported languages.

```
LanguageWaitlist {
  id                    : UUID (PK)
  device_id             : String
  email                 : String (nullable)
  requested_language    : String (ISO 639-1)
  requested_as          : Enum [native, learning]
  created_at            : Timestamp
}
```

---

## 3. API Endpoints

### 3.1 Splash Screen

#### `POST /api/v1/auth/validate-token`

Validates existing session/auth token on app launch.

**Request:**
```json
{
  "token": "string",
  "device_id": "string",
  "device_language": "string (ISO 639-1)"
}
```

**Response (200 — Token valid):**
```json
{
  "valid": true,
  "user": {
    "id": "uuid",
    "app_language": "vi",
    "native_language": "vi",
    "learning_language": "en",
    "onboarding_status": "onboarding_completed",
    "onboarding_step": 7,
    "subscription_status": "premium_monthly"
  },
  "redirect": "home"
}
```

**Response (200 — Token valid, onboarding incomplete):**
```json
{
  "valid": true,
  "user": {
    "id": "uuid",
    "onboarding_status": "native_lang_selected",
    "onboarding_step": 3
  },
  "redirect": "onboarding",
  "resume_step": 3
}
```

**Response (200 — Token invalid/missing):**
```json
{
  "valid": false,
  "redirect": "welcome"
}
```

**Response (200 — Anonymous session exists):**
```json
{
  "valid": false,
  "anonymous_session": {
    "id": "uuid",
    "onboarding_status": "chat_completed",
    "onboarding_step": 4
  },
  "redirect": "onboarding",
  "resume_step": 4
}
```

**Error (500):**
```json
{
  "error": "server_error",
  "message": "Unable to validate token. Please retry.",
  "retry": true
}
```

**Business Rules:**
- Token expiry: 30 days for anonymous sessions, configurable for authenticated users
- Always check anonymous session by device_id if token is invalid — user may have abandoned mid-onboarding
- Return `resume_step` to allow client to skip completed onboarding steps

---

### 3.2 Anonymous Session

#### `POST /api/v1/session/anonymous`

Creates anonymous session when user starts onboarding.

**Request:**
```json
{
  "device_id": "string",
  "device_language": "string (ISO 639-1)"
}
```

**Response (201):**
```json
{
  "session_id": "uuid",
  "session_token": "string",
  "app_language": "en",
  "supported_languages": {
    "native": ["vi", "en"],
    "learning": ["vi", "en"]
  }
}
```

**Business Rules:**
- If anonymous session already exists for device_id AND is not merged, return existing session
- `app_language` is set to `device_language` if supported, otherwise defaults to `"en"`
- Return the list of supported languages for client to display

---

### 3.3 Welcome Screen Completion

#### `PATCH /api/v1/onboarding/welcome-complete`

Marks welcome screens as viewed.

**Request:**
```json
{
  "session_token": "string"
}
```

**Response (200):**
```json
{
  "onboarding_step": 1,
  "onboarding_status": "welcome_completed"
}
```

**Business Rules:**
- Idempotent — calling multiple times does not error
- Client must send this before accessing language selection

---

### 3.4 Language Selection

#### `POST /api/v1/onboarding/native-language`

Sets the user's native language.

**Request:**
```json
{
  "session_token": "string",
  "native_language": "string (ISO 639-1)"
}
```

**Response (200 — Supported language, differs from app language):**
```json
{
  "native_language": "vi",
  "is_supported": true,
  "app_language_mismatch": true,
  "prompt_switch_app_language": true,
  "suggested_app_language": "vi",
  "available_learning_languages": ["en"],
  "onboarding_step": 2,
  "onboarding_status": "native_lang_selected"
}
```

**Response (200 — Supported language, matches app language):**
```json
{
  "native_language": "en",
  "is_supported": true,
  "app_language_mismatch": false,
  "prompt_switch_app_language": false,
  "available_learning_languages": ["vi"],
  "onboarding_step": 2,
  "onboarding_status": "native_lang_selected"
}
```

**Response (200 — Unsupported language):**
```json
{
  "native_language": "en",
  "is_supported": false,
  "original_requested": "ko",
  "forced_to": "en",
  "message": "Korean is coming soon! We'll use English for now.",
  "app_language_mismatch": false,
  "prompt_switch_app_language": false,
  "available_learning_languages": ["vi"],
  "onboarding_step": 2,
  "onboarding_status": "native_lang_selected",
  "waitlist_recorded": true
}
```

**Business Rules:**
- If `native_language` is not in supported list → force to `"en"`, record in LanguageWaitlist
- `available_learning_languages` = all supported languages MINUS native language
- `app_language_mismatch` = true when native_language ≠ current app_language AND native_language is in supported i18n languages
- Must be called AFTER welcome-complete (check onboarding_step ≥ 1)

---

#### `POST /api/v1/onboarding/switch-app-language`

User confirms or declines switching app language.

**Request:**
```json
{
  "session_token": "string",
  "switch": true,
  "new_app_language": "string (ISO 639-1)"
}
```

**Response (200):**
```json
{
  "app_language": "vi",
  "switched": true
}
```

**Business Rules:**
- Only callable when `prompt_switch_app_language` was true in previous response
- `new_app_language` must be a supported i18n language
- If `switch` is false, app_language remains unchanged

---

#### `POST /api/v1/onboarding/learning-language`

Sets the user's learning language.

**Request:**
```json
{
  "session_token": "string",
  "learning_language": "string (ISO 639-1)"
}
```

**Response (200):**
```json
{
  "learning_language": "en",
  "language_pair": "vi_en",
  "onboarding_step": 3,
  "onboarding_status": "learning_lang_selected"
}
```

**Response (400 — Validation error):**
```json
{
  "error": "validation_error",
  "message": "Learning language cannot be the same as native language.",
  "code": "NATIVE_LEARNING_CONFLICT"
}
```

**Response (400 — Unsupported):**
```json
{
  "error": "validation_error",
  "message": "Japanese is not yet available as a learning language.",
  "code": "LEARNING_LANGUAGE_UNSUPPORTED"
}
```

**Business Rules:**
- MUST reject if `learning_language` == `native_language` (error code: `NATIVE_LEARNING_CONFLICT`)
- MUST reject if `learning_language` is not in supported learning languages (error code: `LEARNING_LANGUAGE_UNSUPPORTED`)
- Must be called AFTER native-language is set (check onboarding_step ≥ 2)

---

### 3.5 Anonymous Chat

#### `POST /api/v1/onboarding/chat/start`

Initializes the onboarding chat session.

**Request:**
```json
{
  "session_token": "string"
}
```

**Response (201):**
```json
{
  "chat_session_id": "uuid",
  "initial_message": {
    "id": "uuid",
    "role": "assistant",
    "content": "Hi! I'm excited to help you learn English...",
    "metadata": {
      "quick_replies": ["Career growth", "Travel", "Culture & entertainment", "Study abroad"]
    }
  },
  "chat_language": "en",
  "native_language": "vi"
}
```

**Business Rules:**
- Creates OnboardingChatSession record linked to anonymous session
- If a chat session already exists and status is `active`, return existing session with full message history
- If a chat session exists and status is `completed`, return completed state with scenarios
- AI initial message is in the learning language
- Quick replies help guide the conversation and reduce typing
- Must be called AFTER learning-language is set (check onboarding_step ≥ 3)

---

#### `POST /api/v1/onboarding/chat/message`

Sends user message and receives AI response.

**Request:**
```json
{
  "session_token": "string",
  "chat_session_id": "uuid",
  "message": "string"
}
```

**Response (200 — Conversation continues):**
```json
{
  "user_message": {
    "id": "uuid",
    "role": "user",
    "content": "I want to improve my English for job interviews",
    "message_index": 2
  },
  "assistant_message": {
    "id": "uuid",
    "role": "assistant",
    "content": "Great! Job interviews can be stressful...",
    "message_index": 3,
    "metadata": {
      "quick_replies": ["Beginner", "Intermediate", "Advanced"],
      "data_collected_key": "goal",
      "data_collected_value": "career"
    }
  },
  "is_ended": false,
  "message_count": 3,
  "collected_so_far": {
    "goal": "career",
    "current_level": null,
    "interests": null,
    "daily_time": null
  }
}
```

**Response (200 — Conversation ended):**
```json
{
  "user_message": { ... },
  "assistant_message": {
    "id": "uuid",
    "role": "assistant",
    "content": "I've got a clear picture of your goals now! I've prepared something special for you...",
    "message_index": 12
  },
  "is_ended": true,
  "message_count": 12,
  "collected_so_far": {
    "goal": "career",
    "current_level": "intermediate",
    "interests": ["technology", "business"],
    "daily_time": "15min"
  },
  "onboarding_step": 4,
  "onboarding_status": "chat_completed"
}
```

**Business Rules:**
- AI must collect 4 data points: goal, current_level, interests, daily_time
- Conversation ends (`is_ended: true`) when ALL 4 data points are collected OR max 14 messages (7 exchanges) reached
- If max messages reached without all data, AI gracefully wraps up and marks missing fields as `null`
- Each AI response should attempt to extract data and update `collected_data` in OnboardingChatSession
- `collected_so_far` returned so frontend can show progress indicators if desired
- Rate limit: max 1 message per 2 seconds per session to prevent spam
- Message content max length: 500 characters
- If chat session is already `completed`, return 400 with `CHAT_ALREADY_COMPLETED`

---

#### `GET /api/v1/onboarding/chat/history`

Retrieves full chat history for resuming abandoned conversations.

**Request:**
```
GET /api/v1/onboarding/chat/history?session_token={token}&chat_session_id={uuid}
```

**Response (200):**
```json
{
  "chat_session_id": "uuid",
  "status": "active",
  "messages": [
    {
      "id": "uuid",
      "role": "assistant",
      "content": "Hi! I'm excited to help you...",
      "message_index": 1,
      "metadata": { ... },
      "created_at": "2026-02-28T10:00:00Z"
    },
    ...
  ],
  "collected_so_far": { ... },
  "is_ended": false,
  "message_count": 5
}
```

**Business Rules:**
- Returns all messages ordered by `message_index`
- Used for resuming abandoned chats — client loads history and continues from last message
- If session expired (>30 days), return 410 Gone and require new chat session

---

### 3.6 Scenario Generation

#### `POST /api/v1/onboarding/scenarios/generate`

Generates 5 personalized scenarios based on chat data.

**Request:**
```json
{
  "session_token": "string",
  "chat_session_id": "uuid"
}
```

**Response (201):**
```json
{
  "scenarios": [
    {
      "id": "uuid",
      "title": "Job Interview at a Tech Company",
      "description": "Practice answering common interview questions for a software role...",
      "difficulty": "intermediate",
      "category": "career",
      "sort_order": 1,
      "is_unlocked": false,
      "scenario_data": {
        "context": "You are applying for a marketing position at a tech startup...",
        "ai_role": "Hiring Manager",
        "user_role": "Job Candidate",
        "objectives": ["Introduce yourself", "Describe your experience", "Ask about the role"],
        "key_vocabulary": ["negotiate", "qualifications", "responsibilities"],
        "suggested_duration": 10
      }
    },
    ...
  ],
  "onboarding_step": 5,
  "onboarding_status": "scenarios_generated"
}
```

**Business Rules:**
- MUST be called AFTER chat is completed (check `is_ended: true`)
- Generates exactly 5 scenarios based on `collected_data` from chat session
- All scenarios are `is_unlocked: false` initially
- Scenario generation is idempotent — calling again returns existing scenarios, does NOT regenerate
- Scenarios are stored in GeneratedScenario table and cached in ContentCache
- AI generation timeout: 30 seconds max; if timeout, return partial results with retry flag
- Scenario content is in the learning language; descriptions can include native language hints

---

### 3.7 Authentication

#### `POST /api/v1/auth/login`

Authenticates user and merges anonymous session data.

**Request (Apple):**
```json
{
  "provider": "apple",
  "id_token": "string",
  "session_token": "string (anonymous session token)"
}
```

**Request (Google):**
```json
{
  "provider": "google",
  "id_token": "string",
  "session_token": "string"
}
```

**Request (Email):**
```json
{
  "provider": "email",
  "email": "string",
  "password": "string",
  "session_token": "string",
  "action": "login | register"
}
```

**Response (200 — Success):**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "auth_provider": "google",
    "app_language": "vi",
    "native_language": "vi",
    "learning_language": "en",
    "onboarding_status": "logged_in",
    "onboarding_step": 6
  },
  "auth_token": "string (JWT)",
  "refresh_token": "string",
  "is_new_user": true,
  "merged_from_anonymous": true
}
```

**Response (200 — Existing user, has previous data):**
```json
{
  "user": { ... },
  "auth_token": "string",
  "is_new_user": false,
  "merged_from_anonymous": true,
  "conflict": {
    "existing_native_language": "en",
    "anonymous_native_language": "vi",
    "resolution": "prompt_user"
  }
}
```

**Business Rules — Anonymous Session Merge:**

When a user logs in with an existing anonymous session, the following merge must happen:

| Anonymous Data | Target | Merge Rule |
|:---|:---|:---|
| `native_language` | User.native_language | If user is new → copy. If existing user has different value → prompt user to choose (return `conflict`). |
| `learning_language` | User.learning_language | Same as native_language. |
| `app_language` | User.app_language | If user is new → copy. If existing → keep existing. |
| `onboarding_step` | User.onboarding_step | Take the higher value (further along). |
| OnboardingChatSession | Re-link to User | Update `session_owner_type` to `user`, `session_owner_id` to User.id. |
| GeneratedScenario | Re-link to User | Update `owner_type` to `user`, `owner_id` to User.id. |
| AnonymousSession | Mark merged | Set `merged_to_user_id` = User.id. |

**Authentication Rules:**
- Apple: Validate `id_token` with Apple's public keys
- Google: Validate `id_token` with Google's OAuth2 endpoint
- Email (register): Validate email format, password minimum 8 chars, check uniqueness
- Email (login): Validate credentials against stored hash
- All providers: If `session_token` is provided, execute anonymous merge
- Return `is_new_user` flag so client knows whether to show onboarding resume or fresh start

---

### 3.8 Scenario Unlock & Practice

#### `POST /api/v1/scenarios/{scenario_id}/unlock`

Unlocks a scenario for practice (requires authentication).

**Request:**
```
Authorization: Bearer {auth_token}
POST /api/v1/scenarios/{scenario_id}/unlock
```

**Response (200):**
```json
{
  "scenario_id": "uuid",
  "is_unlocked": true,
  "scenario_data": { ... }
}
```

**Business Rules:**
- First scenario unlock is free (no subscription required)
- Subsequent scenario unlocks require active subscription OR trigger paywall
- Track which scenario is the "first free" one per user

---

#### `POST /api/v1/scenarios/{scenario_id}/complete`

Marks scenario as completed and triggers paywall check.

**Request:**
```
Authorization: Bearer {auth_token}
POST /api/v1/scenarios/{scenario_id}/complete
```

**Response (200):**
```json
{
  "scenario_id": "uuid",
  "is_completed": true,
  "show_paywall": true,
  "paywall_trigger": "first_scenario_completed",
  "remaining_free_scenarios": 0,
  "onboarding_step": 7,
  "onboarding_status": "first_scenario_completed"
}
```

**Business Rules:**
- After first scenario completion → `show_paywall: true`
- `remaining_free_scenarios: 0` signals client to show paywall
- If user already has active subscription → `show_paywall: false`
- Update onboarding_status to `first_scenario_completed`

---

### 3.9 Paywall

#### `GET /api/v1/subscription/plans`

Returns available subscription plans.

**Request:**
```
Authorization: Bearer {auth_token}
GET /api/v1/subscription/plans
```

**Response (200):**
```json
{
  "plans": [
    {
      "id": "premium_monthly",
      "name": "Premium Monthly",
      "price": "#TODO",
      "currency": "VND",
      "billing_period": "monthly",
      "features": ["All 5 personalized scenarios", "Unlimited AI conversation", "Smart review system"],
      "apple_product_id": "com.flowering.premium.monthly",
      "google_product_id": "premium_monthly"
    },
    {
      "id": "premium_annual",
      "name": "Premium Annual",
      "price": "#TODO",
      "currency": "VND",
      "billing_period": "annual",
      "savings_percent": 40,
      "is_highlighted": true,
      "features": ["Everything in Monthly", "40% savings", "Priority support"],
      "apple_product_id": "com.flowering.premium.annual",
      "google_product_id": "premium_annual"
    }
  ],
  "paywall_context": {
    "trigger": "first_scenario_completed",
    "user_goal": "career",
    "scenarios_remaining": 4
  }
}
```

#### `POST /api/v1/subscription/verify-purchase`

Validates in-app purchase receipt from Apple/Google.

**Request:**
```json
{
  "platform": "apple | google",
  "receipt_data": "string",
  "product_id": "string"
}
```

**Response (200):**
```json
{
  "subscription_status": "premium_annual",
  "expires_at": "2027-02-28T00:00:00Z",
  "all_scenarios_unlocked": true,
  "onboarding_status": "onboarding_completed"
}
```

**Business Rules:**
- Validate receipt with Apple App Store / Google Play Store server-side
- Update User.subscription_status and User.subscription_expires
- Unlock all 5 scenarios immediately upon successful subscription
- If user dismisses paywall ("Not now"), update onboarding_status to `onboarding_completed` and keep `subscription_status: free`

---

### 3.10 Language Settings (Post-Onboarding)

#### `GET /api/v1/user/language-settings`

Returns current language configuration.

**Request:**
```
Authorization: Bearer {auth_token}
```

**Response (200):**
```json
{
  "app_language": "vi",
  "native_language": "vi",
  "learning_language": "en",
  "active_language_pair": "vi_en",
  "available_language_pairs": [
    { "native": "vi", "learning": "en", "has_cached_content": true },
    { "native": "en", "learning": "vi", "has_cached_content": false }
  ],
  "supported_languages": ["vi", "en"]
}
```

---

#### `POST /api/v1/user/switch-language`

Switches the active language pair.

**Request:**
```json
{
  "new_native_language": "en",
  "new_learning_language": "vi"
}
```

**Response (200 — Cached content exists):**
```json
{
  "native_language": "en",
  "learning_language": "vi",
  "active_language_pair": "en_vi",
  "content_status": "loaded_from_cache",
  "regeneration_required": false,
  "prompt_switch_app_language": true,
  "suggested_app_language": "en"
}
```

**Response (200 — No cache, regeneration needed):**
```json
{
  "native_language": "en",
  "learning_language": "vi",
  "active_language_pair": "en_vi",
  "content_status": "regenerating",
  "regeneration_required": true,
  "estimated_time_seconds": 30,
  "prompt_switch_app_language": true,
  "suggested_app_language": "en"
}
```

**Business Rules:**
- Validate: `new_native_language` ≠ `new_learning_language`
- Validate: both languages are in supported list
- Check ContentCache for existing content with key `{new_native}_{new_learning}`
- If cache exists → load instantly, no regeneration
- If cache does NOT exist → trigger async content regeneration, return `regenerating` status
- Previous language pair's progress is saved separately (not deleted)
- Previous language pair's content remains in ContentCache (not deleted)
- If new native ≠ current app_language → return `prompt_switch_app_language: true`

---

#### `GET /api/v1/user/content-regeneration-status`

Polls regeneration progress after language switch.

**Request:**
```
Authorization: Bearer {auth_token}
GET /api/v1/user/content-regeneration-status?language_pair=en_vi
```

**Response (200):**
```json
{
  "language_pair": "en_vi",
  "status": "in_progress | completed | failed",
  "progress_percent": 65,
  "estimated_remaining_seconds": 12
}
```

---

## 4. Business Logic Rules

### 4.1 Onboarding Step Enforcement

Each API endpoint enforces that the user has completed all previous steps. The backend must reject requests that skip steps.

| Step | Status | Required Before Accessing |
|:---:|:---|:---|
| 0 | `not_started` | — |
| 1 | `welcome_completed` | native-language endpoint |
| 2 | `native_lang_selected` | learning-language endpoint |
| 3 | `learning_lang_selected` | chat/start endpoint |
| 4 | `chat_completed` | scenarios/generate endpoint |
| 5 | `scenarios_generated` | auth/login endpoint (for scenario unlock) |
| 6 | `logged_in` | scenarios/{id}/unlock endpoint |
| 7 | `first_scenario_completed` | paywall display |

**Enforcement response (400):**
```json
{
  "error": "step_not_reached",
  "message": "Please complete the previous step first.",
  "current_step": 2,
  "required_step": 3
}
```

### 4.2 Rate Limits

| Endpoint | Limit | Window |
|:---|:---|:---|
| `POST /auth/validate-token` | 10 requests | per minute per device |
| `POST /onboarding/chat/message` | 1 request | per 2 seconds per session |
| `POST /onboarding/scenarios/generate` | 3 requests | per hour per session |
| `POST /auth/login` | 5 requests | per minute per device |
| `POST /user/switch-language` | 5 requests | per hour per user |

### 4.3 Data Validation Rules

| Field | Rule |
|:---|:---|
| `native_language` | Must be valid ISO 639-1 code |
| `learning_language` | Must be valid ISO 639-1, must be in supported list, must ≠ native_language |
| `app_language` | Must be in supported i18n list (V1: `vi`, `en`), fallback to `en` |
| Chat message content | Max 500 characters, trimmed, no empty strings |
| Email | Valid email format, max 254 characters |
| Password | Min 8 characters |

---

## 5. Language System Logic

### 5.1 Language Resolution Flow

```
App starts
  ↓
Read device language
  ↓
Is device language in supported i18n list? (V1: vi, en)
  ├── Yes → app_language = device_language
  └── No  → app_language = "en" (fallback)
  ↓
User selects native language
  ↓
Is native language in supported content list? (V1: vi, en)
  ├── Yes → native_language = selected
  │     ↓
  │   native_language ≠ app_language?
  │     ├── Yes → Prompt: "Switch app to {native_language}?"
  │     │     ├── Accept → app_language = native_language
  │     │     └── Decline → app_language unchanged
  │     └── No → Continue
  └── No  → native_language = "en" (forced)
  │         Record in LanguageWaitlist
  │         Show message: "{Language} coming soon!"
  ↓
Show available learning languages = supported_list - native_language
  ↓
User selects learning language
  ↓
Validate: learning ≠ native (server-side, should be impossible via UI)
  ↓
Language pair established: {native}_{learning}
```

### 5.2 V1 Valid Language Pairs

| Pair Key | Native | Learning | App Language Options |
|:---|:---|:---|:---|
| `vi_en` | Vietnamese | English | Vietnamese or English |
| `en_vi` | English | Vietnamese | English or Vietnamese |

### 5.3 Content Language Rules

| Content Type | Language Used | Example |
|:---|:---|:---|
| App UI (buttons, labels, nav) | `app_language` (i18n) | "Tiếp tục" / "Continue" |
| Grammar explanations | `native_language` | "Negotiate nghĩa là thương lượng" |
| Vocabulary definitions | `native_language` | Word translations |
| AI chat messages | `learning_language` | "Let's practice ordering coffee" |
| Scenario titles | `learning_language` | "Job Interview at a Tech Company" |
| Scenario descriptions | `learning_language` with `native_language` hints | Mixed |
| Push notifications | `app_language` | System notifications |
| Error messages | `app_language` | "Something went wrong" |

---

## 6. Content Generation & Caching

### 6.1 Cache Strategy

```
Cache Key Format: {user_id}_{native_language}_{learning_language}

Example:
  user_123_vi_en → Vietnamese native, learning English content
  user_123_en_vi → English native, learning Vietnamese content

Cache Lifecycle:
  1. First generation: Created when language pair is first established
  2. Language switch (cache exists): Load from cache, no API cost
  3. Language switch (no cache): Generate new content, save to cache
  4. Switch back: Load from previous cache (zero cost)
  5. Content never deleted (only deactivated with is_active flag)
```

### 6.2 Content Generation Triggers

| Trigger | Action | Async? |
|:---|:---|:---|
| Onboarding chat completed | Generate 5 scenarios | Yes (with loading state) |
| Language switch (no cache) | Regenerate all content for new pair | Yes (polling endpoint) |
| Language switch (cache exists) | Load from cache | No (instant) |
| User changes native language | Check cache → generate if missing | Yes |

### 6.3 Generation Cost Control

| Control | Implementation |
|:---|:---|
| Idempotent generation | Same input → return cached result, don't regenerate |
| Max scenarios per user | 5 per language pair during onboarding |
| Generation timeout | 30 seconds max per generation call |
| Retry limit | 3 retries per generation, then fail gracefully |
| Queue system | Async generation with polling, not blocking |

---

## 7. Edge Cases & Error Handling

### 7.1 Onboarding Edge Cases

| Case | Trigger | Backend Handling |
|:---|:---|:---|
| User kills app during splash | Token check interrupted | Next launch re-checks token; no data loss |
| User kills app during welcome screens | Step 0 or 1 | Next launch: `resume_step` sends user back to welcome or last viewed screen |
| User kills app after native language selection | Step 2 | Next launch: skip welcome, go to learning language screen |
| User kills app mid-chat | Chat session active | Next launch: load chat history, resume from last message |
| User kills app after chat, before scenarios | Step 4 | Next launch: trigger scenario generation |
| User kills app during scenario generation | Async job running | Next launch: check job status; if complete → show scenarios; if failed → retry |
| User kills app after login | Step 6 | Next launch: token valid → resume to scenario selection |
| Anonymous session expires (30 days) | Session TTL exceeded | Delete session; user starts fresh onboarding |
| User reinstalls app | New device_id or same device_id | If same device_id → find anonymous session; if different → fresh start |
| Two devices, same account | Token valid on both | Both devices see same user state; last write wins for language settings |

### 7.2 API Error Responses

All errors follow a consistent format:

```json
{
  "error": "error_code",
  "message": "Human-readable description",
  "code": "MACHINE_READABLE_CODE",
  "retry": true | false,
  "details": { ... }
}
```

| HTTP Status | Error Code | When |
|:---:|:---|:---|
| 400 | `validation_error` | Invalid input data |
| 400 | `step_not_reached` | Onboarding step enforcement failed |
| 401 | `unauthorized` | Invalid or expired token |
| 404 | `not_found` | Resource not found |
| 409 | `conflict` | Duplicate resource (e.g., email already exists) |
| 410 | `gone` | Session expired |
| 429 | `rate_limited` | Too many requests |
| 500 | `server_error` | Internal server error |
| 503 | `service_unavailable` | AI service down |

### 7.3 AI Service Failure Handling

| Failure Type | Handling |
|:---|:---|
| Chat AI response timeout (>10s) | Return 503 with retry flag; client shows "AI is thinking..." then retries |
| Chat AI returns invalid response | Log error, retry once; if still invalid, return generic follow-up message |
| Scenario generation timeout (>30s) | Return partial results if any; client polls for remaining |
| Scenario generation fails entirely | Return 503; allow retry up to 3 times; after 3 failures, offer fallback generic scenarios |
| AI service completely down | Return 503; client shows "We're experiencing issues, please try later" |

### 7.4 Offline Behavior

| Step | Offline Capability | Notes |
|:---|:---|:---|
| Splash (Step 0) | ❌ Requires internet | Token validation needs API call |
| Welcome screens (Step 1) | ✅ Works offline | Static content, loaded from app bundle |
| Native language selection (Step 2A) | ⚠️ Partial | Language list can be cached; selection needs API to save |
| Learning language selection (Step 2B) | ⚠️ Partial | Same as above |
| Anonymous chat (Step 3) | ❌ Requires internet | AI-powered, real-time |
| Scenario display (Step 4-5) | ⚠️ Partial | If already generated, can display cached; generation needs internet |
| Login (Step 6) | ❌ Requires internet | OAuth requires internet |
| Paywall (Step 7) | ❌ Requires internet | Purchase verification needs internet |

**Offline queue strategy:** If user makes a selection offline (e.g., native language), queue the API call and sync when connection is restored. Client proceeds optimistically.

---

## 8. Analytics Events

### 8.1 Onboarding Funnel Events

Every step must fire an analytics event for funnel tracking.

| Event Name | Trigger | Properties |
|:---|:---|:---|
| `onboarding_started` | Splash screen loads, no valid token | `device_language`, `device_id` |
| `welcome_screen_viewed` | Each welcome screen displayed | `screen_index` (1, 2, 3) |
| `welcome_completed` | CTA tapped on screen 3 | `time_spent_seconds` |
| `native_language_selected` | Native language confirmed | `language_code`, `is_supported`, `was_forced` |
| `app_language_prompt_shown` | Mismatch prompt displayed | `current_app_lang`, `suggested_lang` |
| `app_language_switched` | User accepts/declines switch | `switched` (boolean), `new_app_lang` |
| `learning_language_selected` | Learning language confirmed | `language_code`, `language_pair` |
| `chat_started` | First AI message displayed | `language_pair` |
| `chat_message_sent` | User sends message | `message_index`, `message_length` |
| `chat_data_collected` | AI extracts a data point | `data_key`, `data_value` |
| `chat_completed` | AI sets end flag | `message_count`, `time_spent_seconds`, `data_completeness` |
| `scenarios_generated` | 5 scenarios returned | `scenario_categories[]` |
| `scenario_tapped` | User taps a scenario card | `scenario_id`, `scenario_category` |
| `login_prompt_shown` | Login gate displayed | `trigger` ("scenario_tap") |
| `login_attempted` | User taps login method | `provider` ("apple", "google", "email") |
| `login_completed` | Authentication successful | `provider`, `is_new_user`, `merged_anonymous` |
| `login_failed` | Authentication failed | `provider`, `error_code` |
| `scenario_unlocked` | First scenario unlocked | `scenario_id`, `is_free` |
| `scenario_completed` | User finishes scenario | `scenario_id`, `time_spent_seconds` |
| `paywall_shown` | Paywall displayed | `trigger`, `plans_shown[]` |
| `paywall_plan_selected` | User taps a plan | `plan_id` |
| `paywall_purchased` | Purchase verified | `plan_id`, `price`, `currency` |
| `paywall_dismissed` | User taps "Not now" | `time_on_paywall_seconds` |
| `onboarding_completed` | User reaches home screen | `total_time_seconds`, `subscription_status` |

### 8.2 Drop-off Events

| Event Name | Trigger | Properties |
|:---|:---|:---|
| `onboarding_abandoned` | Session inactive >24 hours | `last_step`, `time_spent_total` |
| `chat_abandoned` | User leaves mid-chat | `message_count`, `data_collected_count` |
| `language_waitlisted` | User selects unsupported language | `requested_language`, `requested_as` |

---

## 9. Open Questions

These items require decisions before backend implementation:

| # | Question | Impact | Blocking? |
|:---|:---|:---|:---:|
| 1 | AI persona name and personality for onboarding chat | Chat prompt engineering, UX copy | Yes |
| 2 | Exact subscription pricing (VND amounts) | Paywall API, App Store setup | Yes |
| 3 | Free tier limitations (what can unpaid users access?) | Scenario unlock logic, paywall trigger | Yes |
| 4 | Chat AI model selection (GPT-4, Claude, custom?) | Infrastructure, cost estimation | Yes |
| 5 | Maximum content cache size per user | Database capacity planning | No |
| 6 | Anonymous session expiry (30 days confirmed?) | Data retention policy | No |
| 7 | Fallback generic scenarios if AI fails | Content creation | No |
| 8 | Password reset flow for email auth | Auth system design | No |
| 9 | Multi-device session management | Token strategy | No |
| 10 | GDPR/privacy compliance for anonymous data | Data model, deletion policy | No (but needed pre-launch) |

---

## Appendix A: Database Schema (SQL)

```sql
-- V1 Supported Languages Reference
CREATE TABLE supported_languages (
    code VARCHAR(5) PRIMARY KEY,           -- ISO 639-1
    name_english VARCHAR(100) NOT NULL,
    name_native VARCHAR(100) NOT NULL,
    is_i18n_supported BOOLEAN DEFAULT FALSE,
    is_content_supported BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO supported_languages VALUES
('vi', 'Vietnamese', 'Tiếng Việt', TRUE, TRUE, TRUE, NOW()),
('en', 'English', 'English', TRUE, TRUE, TRUE, NOW());

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(254) UNIQUE,
    auth_provider VARCHAR(20) CHECK (auth_provider IN ('apple', 'google', 'email')),
    auth_provider_id VARCHAR(255),
    password_hash VARCHAR(255),
    
    app_language VARCHAR(5) NOT NULL DEFAULT 'en',
    native_language VARCHAR(5) REFERENCES supported_languages(code),
    learning_language VARCHAR(5) REFERENCES supported_languages(code),
    
    onboarding_status VARCHAR(50) NOT NULL DEFAULT 'not_started',
    onboarding_step INTEGER NOT NULL DEFAULT 0,
    
    subscription_status VARCHAR(30) NOT NULL DEFAULT 'free',
    subscription_expires TIMESTAMP,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    CONSTRAINT native_ne_learning CHECK (native_language != learning_language)
);

-- Anonymous Sessions
CREATE TABLE anonymous_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR(255) NOT NULL,
    device_language VARCHAR(5) NOT NULL,
    
    app_language VARCHAR(5) NOT NULL DEFAULT 'en',
    native_language VARCHAR(5),
    learning_language VARCHAR(5),
    
    onboarding_status VARCHAR(50) NOT NULL DEFAULT 'not_started',
    onboarding_step INTEGER NOT NULL DEFAULT 0,
    
    session_token VARCHAR(255) UNIQUE NOT NULL,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    merged_to_user_id UUID REFERENCES users(id),
    
    CONSTRAINT anon_native_ne_learning CHECK (
        native_language IS NULL OR learning_language IS NULL 
        OR native_language != learning_language
    )
);

CREATE INDEX idx_anon_sessions_device ON anonymous_sessions(device_id);
CREATE INDEX idx_anon_sessions_token ON anonymous_sessions(session_token);

-- Onboarding Chat Sessions
CREATE TABLE onboarding_chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_owner_type VARCHAR(10) NOT NULL CHECK (session_owner_type IN ('anonymous', 'user')),
    session_owner_id UUID NOT NULL,
    
    native_language VARCHAR(5) NOT NULL,
    learning_language VARCHAR(5) NOT NULL,
    
    status VARCHAR(20) NOT NULL DEFAULT 'active' 
        CHECK (status IN ('active', 'completed', 'abandoned', 'expired')),
    
    collected_data JSONB NOT NULL DEFAULT '{}',
    message_count INTEGER NOT NULL DEFAULT 0,
    is_ended BOOLEAN NOT NULL DEFAULT FALSE,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Chat Messages
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_session_id UUID NOT NULL REFERENCES onboarding_chat_sessions(id),
    
    role VARCHAR(10) NOT NULL CHECK (role IN ('system', 'assistant', 'user')),
    content TEXT NOT NULL,
    message_index INTEGER NOT NULL,
    
    metadata JSONB,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    UNIQUE (chat_session_id, message_index)
);

-- Generated Scenarios
CREATE TABLE generated_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_type VARCHAR(10) NOT NULL CHECK (owner_type IN ('anonymous', 'user')),
    owner_id UUID NOT NULL,
    
    chat_session_id UUID NOT NULL REFERENCES onboarding_chat_sessions(id),
    
    native_language VARCHAR(5) NOT NULL,
    learning_language VARCHAR(5) NOT NULL,
    
    title VARCHAR(255) NOT NULL,
    description TEXT,
    difficulty VARCHAR(20) CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
    category VARCHAR(50),
    
    scenario_data JSONB NOT NULL,
    
    sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 1 AND 5),
    is_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Content Cache
CREATE TABLE content_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    
    cache_key VARCHAR(20) NOT NULL,  -- format: "{native}_{learning}"
    
    native_language VARCHAR(5) NOT NULL,
    learning_language VARCHAR(5) NOT NULL,
    
    content_type VARCHAR(30) NOT NULL 
        CHECK (content_type IN ('scenarios', 'vocabulary', 'grammar_tips', 'lesson_content')),
    content_data JSONB NOT NULL,
    
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    UNIQUE (user_id, cache_key, content_type)
);

CREATE INDEX idx_content_cache_user_pair ON content_cache(user_id, cache_key, is_active);

-- Language Waitlist
CREATE TABLE language_waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR(255) NOT NULL,
    email VARCHAR(254),
    requested_language VARCHAR(5) NOT NULL,
    requested_as VARCHAR(10) NOT NULL CHECK (requested_as IN ('native', 'learning')),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_waitlist_language ON language_waitlist(requested_language);
```

---

## Appendix B: State Machine Diagram

```
                    ┌──────────────┐
                    │ not_started  │ (Step 0)
                    └──────┬───────┘
                           │ POST /onboarding/welcome-complete
                           ▼
                    ┌──────────────────┐
                    │welcome_completed │ (Step 1)
                    └──────┬───────────┘
                           │ POST /onboarding/native-language
                           ▼
                    ┌─────────────────────┐
                    │native_lang_selected │ (Step 2)
                    └──────┬──────────────┘
                           │ POST /onboarding/learning-language
                           ▼
                    ┌───────────────────────┐
                    │learning_lang_selected │ (Step 3)
                    └──────┬────────────────┘
                           │ POST /onboarding/chat/message (is_ended=true)
                           ▼
                    ┌────────────────┐
                    │chat_completed  │ (Step 4)
                    └──────┬─────────┘
                           │ POST /onboarding/scenarios/generate
                           ▼
                    ┌─────────────────────┐
                    │scenarios_generated  │ (Step 5)
                    └──────┬──────────────┘
                           │ POST /auth/login
                           ▼
                    ┌─────────┐
                    │logged_in│ (Step 6)
                    └──────┬──┘
                           │ POST /scenarios/{id}/complete
                           ▼
              ┌──────────────────────────┐
              │first_scenario_completed  │ (Step 7)
              └──────┬───────────────────┘
                     │ Paywall accepted/dismissed
                     ▼
              ┌──────────────────────┐
              │onboarding_completed  │
              └──────────────────────┘
```

---

*End of Document*
