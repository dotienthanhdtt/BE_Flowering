# Brainstorm: Anonymous Onboarding Chat Feature

## Problem Statement
Mobile users need to chat with AI during onboarding (pre-login) to experience a "wow moment" via personalized content. The AI collects name, age, region, and learning motivation through natural conversation. Data must persist, link to user account post-registration, and integrate with existing Langfuse tracing.

## Requirements
- Anonymous (unauthenticated) chat with server-generated session token
- Max 10 turns, configurable via TypeScript config file
- 7-day session TTL
- Messages saved in database
- AI prompt in .md file
- Langfuse tracing for all conversations
- Structured JSON extraction on completion
- Simple request-response (no streaming)
- Link conversation to user account after registration
- Existing IP-based rate limiting (no additional abuse protection)

## Evaluated Approaches

### Approach A: Nullable user_id on ai_conversations (SELECTED)
- Make `user_id` nullable, add `session_token`, `type`, `expires_at` columns
- Reuse existing `ai_conversation_messages` table
- **Pros:** DRY, minimal migration, reuse existing entities/repos, message_count tracks turns
- **Cons:** Nullable FK (minor), need cleanup for expired sessions

### Approach B: New onboarding-specific tables
- Separate `onboarding_conversations` + `onboarding_messages`
- **Pros:** Zero risk to existing code, clean isolation
- **Cons:** DRY violation (duplicate schema), linking requires cross-table migration, more entities to maintain

### Approach C: Ghost user records
- Create anonymous User with `is_anonymous` flag
- **Pros:** No schema changes to conversations
- **Cons:** Pollutes users table, complex merge logic, abandoned records accumulate

**Decision:** Approach A — KISS/DRY winner. Identical message schema, one-line nullable migration, existing queries unaffected.

## Recommended Architecture

### Database Changes (single migration)
```sql
ALTER TABLE ai_conversations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE ai_conversations ADD COLUMN session_token VARCHAR(255) UNIQUE;
ALTER TABLE ai_conversations ADD COLUMN type VARCHAR(20) DEFAULT 'chat';
ALTER TABLE ai_conversations ADD COLUMN expires_at TIMESTAMPTZ;
CREATE INDEX idx_ai_conversations_session_token ON ai_conversations(session_token);
CREATE INDEX idx_ai_conversations_type ON ai_conversations(type);
```

### Module Structure
```
src/modules/onboarding/
├── onboarding.module.ts
├── onboarding.controller.ts     (3 @Public() endpoints)
├── onboarding.service.ts        (session + AI orchestration)
├── onboarding.config.ts         (maxTurns, model, TTL, etc.)
└── dto/
    ├── start-onboarding.dto.ts
    ├── onboarding-chat.dto.ts
    └── onboarding-complete.dto.ts
```

### New Prompt
```
src/modules/ai/prompts/onboarding-chat-prompt.md
```
AI persona: friendly onboarding assistant. Goal: naturally collect name, age, region, learning motivation through conversation. On final turn, extract structured data.

### API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/onboarding/start` | @Public() | Create session + conversation, return session_token |
| POST | `/onboarding/chat` | @Public() | Send message with session_token, get AI reply |
| POST | `/onboarding/complete` | @Public() | Extract structured JSON from conversation |

### Request/Response Contracts

**POST /onboarding/start**
```json
// Request
{ "native_language": "vi", "target_language": "en" }
// Response
{ "code": 1, "message": "Session created", "data": { "session_token": "uuid", "conversation_id": "uuid" } }
```

**POST /onboarding/chat**
```json
// Request
{ "session_token": "uuid", "message": "Hi! I'm Thanh" }
// Response
{ "code": 1, "message": "Success", "data": { "reply": "Nice to meet you Thanh!...", "turn_number": 1, "is_last_turn": false } }
```

**POST /onboarding/complete**
```json
// Request
{ "session_token": "uuid" }
// Response
{ "code": 1, "message": "Success", "data": { "name": "Thanh", "age": 25, "region": "Vietnam", "learning_motivation": "travel", "suggested_proficiency": "beginner" } }
```

### Conversation Linking
- Add optional `session_token` param to existing register/login endpoints
- After user creation: `UPDATE ai_conversations SET user_id = :userId WHERE session_token = :token`
- Clear session_token after linking (optional)

### Turn Management
- `message_count` on `ai_conversations` tracks total messages
- Check `message_count >= maxTurns * 2` before processing (user + assistant = 2 per turn)
- On final turn, prompt instructs AI to wrap up and summarize

### Langfuse Integration
- `sessionId` = session_token
- `userId` = `'anonymous'`
- metadata: `{ feature: 'onboarding', conversationId }`

### Config File (`onboarding.config.ts`)
```typescript
export const onboardingConfig = {
  maxTurns: 10,
  sessionTtlDays: 7,
  llmModel: LLMModel.GEMINI_2_5_FLASH,
  maxTokens: 1024,
  temperature: 0.7,
};
```

### Cleanup Strategy
- Expired sessions: DELETE WHERE type='onboarding' AND user_id IS NULL AND expires_at < NOW()
- Can be cron job or manual initially

## Implementation Phases (high-level)
1. **Migration** — Schema changes to ai_conversations entity
2. **Config + Prompt** — onboarding.config.ts + onboarding-chat-prompt.md
3. **Module** — Controller, Service, DTOs with @Public() endpoints
4. **Linking** — Add session_token param to auth register flow
5. **Testing** — Unit tests for service, e2e for endpoints
6. **Langfuse** — Verify tracing with anonymous sessions

## Risk Assessment
- **Low:** Nullable user_id won't break existing queries (all filter by user_id)
- **Low:** Rate limiting already handles anonymous abuse via IP
- **Medium:** Session token management — need proper validation and expiry checks
- **Low:** Cleanup — manual DB cleanup acceptable for MVP

## Success Criteria
- Anonymous user can complete 10-turn onboarding chat without auth
- Conversation persists across app restarts (within 7 days)
- Structured data extracted accurately from conversation
- Conversation linked to user account after registration
- All conversations traced in Langfuse with session correlation
- Existing authenticated chat features unaffected
