# Brainstorm: `/scenario/chat` API (Scenario Roleplay)

**Date:** 2026-04-12
**Context:** New backend endpoint for AI-powered scenario roleplay chat. Modeled after existing onboarding chat but JWT-protected and parameterized by `scenarioId`.

---

## Problem Statement

Add an API enabling authenticated users to engage in immersive language-learning roleplay conversations, where the AI plays a character implied by a `Scenario` entity. Conversation context (scenario + user language pair + level) must be injected into the prompt. Prompt template stored as a JSON file.

## Requirements

**Functional**
- JWT-protected (per-user, resumable conversation per scenario).
- Single endpoint: `POST /scenario/chat`.
- Fixed turn cap (default **12**). AI naturally winds down on last turn. `completed: true` flag returned when cap reached.
- Plain-text reply per turn (no structured correction/hints in response).
- AI infers character + setting from scenario `title` + `description` (no new roleplay schema fields).
- Respect existing premium/trial gating via `Scenario.isPremium`, `isTrial`, `UserScenarioAccess`.

**Non-functional**
- Reuse `AiConversation` + `AiConversationMessage` + `PromptLoaderService` + `UnifiedLLMService`.
- Prompt in structured JSON (same style as `correction-check-prompt.json`).
- Token budget ≤ 4k per turn (12 turns × 2 msgs + system prompt).

## Evaluated Approaches

### A. Two endpoints (/start + /chat, like onboarding) — REJECTED
- Pros: clear separation, explicit "opening scene" step.
- Cons: more routes, more client calls, duplicates find-or-create logic.

### B. Single `/scenario/chat` endpoint — **CHOSEN**
- Pros: KISS, one route, minimal client logic.
- Cons: endpoint handles 3 states (new+opening, new+user-opens, ongoing) — slight branching.

### C. Polymorphic `/chat` accepting lessonId OR scenarioId — REJECTED
- Pros: unified chat surface for all AI chat types.
- Cons: YAGNI, couples lesson-tutor and scenario-roleplay domains prematurely.

### D. Add roleplay metadata columns (character/setting/targetPhrases) — DEFERRED
- Pros: richer, more consistent AI responses.
- Cons: schema migration + admin UI to populate. Premature. AI can infer for MVP.

## Chosen Solution

### Endpoint
`POST /scenario/chat`

**Request**
```json
{ "scenarioId": "uuid", "message": "string?", "conversationId": "uuid?" }
```

**Response**
```json
{
  "reply": "string",
  "conversationId": "uuid",
  "turn": 1,
  "maxTurns": 12,
  "completed": false
}
```

**Branching**
| Case | Behavior |
|---|---|
| No `conversationId` + empty `message` | Find-or-create conversation. AI generates opening (sets scene, greets). |
| No `conversationId` + non-empty `message` | Find-or-create. AI responds in character to user opener. |
| `conversationId` provided | Validate ownership + scenario match. Append turn. |
| `turn > maxTurns` | Reject (return last reply + `completed: true`). |
| To restart | Client omits `conversationId` after `completed: true` — service archives and creates new. |

### Prompt: `src/modules/ai/prompts/scenario-chat-prompt.json`
```json
{
  "role": "Immersive language-learning roleplay partner",
  "instruction": "Play the character and setting implied by the scenario. Stay in character. Calibrate difficulty to the learner.",
  "scenario": {
    "title": "{{scenarioTitle}}",
    "description": "{{scenarioDescription}}",
    "category": "{{scenarioCategory}}"
  },
  "learner": {
    "target_language": "{{targetLanguage}}",
    "native_language": "{{nativeLanguage}}",
    "proficiency_level": "{{proficiencyLevel}}"
  },
  "turn_context": {
    "current_turn": "{{currentTurn}}",
    "max_turns": "{{maxTurns}}",
    "is_opening": "{{isOpening}}",
    "is_wrap_up": "{{isWrapUp}}"
  },
  "rules": [
    "Reply only in {{targetLanguage}}; add short native-language gloss only if proficiency=beginner",
    "Stay in character, don't break the fourth wall",
    "Keep reply <= 3 sentences",
    "If is_opening=true: greet the user and set the scene",
    "If is_wrap_up=true: wind the scenario down naturally with brief closure"
  ],
  "output_rules": { "format": "plain_text", "no_prefix": true, "language": "{{targetLanguage}}" }
}
```

### Data Model Changes
`ai_conversations` table:
- ADD `scenario_id uuid NULL` (FK `scenarios.id`)
- ADD `max_turns smallint NULL DEFAULT 12`
- ADD `completed boolean NOT NULL DEFAULT false` (skip if existing `status` enum already covers)
- INDEX `(user_id, scenario_id, completed)` — fast find-or-create.

Migration file under `src/database/migrations/`.

### Service Layer
**New:** `src/modules/scenario/scenario-chat.service.ts`
- Keeps scenario-roleplay logic isolated from `LearningAgentService` (different prompt, different context shape).
- Depends on: `PromptLoaderService`, `UnifiedLLMService`, `ScenarioService` (access check), `UserLanguageService`, `AiConversationRepository`, `AiConversationMessageRepository`.

**New:** `src/modules/scenario/scenario-chat.controller.ts`
- Route: `POST /scenario/chat`
- DTO validation via `class-validator`.
- Calls service, wraps in standard `{code, message, data}` response (global interceptor handles).

### Turn Flow
1. Resolve conversation (new or existing).
2. Load `Scenario` + verify access (reuse `ScenarioService.checkAccess`).
3. Load `UserLanguage` (target/native/proficiency) for `userId`.
4. Load last 20 messages as history.
5. Compute: `currentTurn`, `isOpening` (history empty), `isWrapUp` (currentTurn >= maxTurns - 1).
6. `PromptLoader.loadPrompt('scenario-chat-prompt.json', vars)` → JSON-stringify → `SystemMessage`.
7. `UnifiedLLMService.chat([system, ...history, HumanMessage(message)])`. Skip user message insertion when `isOpening && !message`.
8. Persist user message (if any) + AI reply. Bump `messageCount`. Set `completed=true` if at cap.
9. Return `{ reply, conversationId, turn, maxTurns, completed }`.

### Files
**Create**
- `src/modules/scenario/scenario-chat.controller.ts`
- `src/modules/scenario/scenario-chat.service.ts`
- `src/modules/scenario/dto/scenario-chat.dto.ts`
- `src/modules/ai/prompts/scenario-chat-prompt.json`
- `src/database/migrations/{timestamp}-add-scenario-chat-fields.ts`

**Modify**
- `src/modules/scenario/scenario.module.ts` — register new controller/service, import `AiModule` (for services) + `TypeOrmModule.forFeature([AiConversation, AiConversationMessage])`.
- `src/database/entities/ai-conversation.entity.ts` — add `scenarioId`, `maxTurns`, `completed`.
- `src/database/database.module.ts` — already registers `AiConversation` (verify).

**Verify**
- `PromptLoaderService` handles `.json` files correctly (scout confirmed — already used by `correction-check-prompt.json`).
- `ScenarioService.checkAccess(userId, scenarioId)` exists or needs extraction from existing visibility query.

## Implementation Considerations & Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI improvisation drift (no character fields) | Med | Low | Accept for MVP; add metadata columns later if content team reports inconsistency. |
| `PromptLoader` returns parsed JSON obj instead of string | Low | Med | Unit test: assert loaded prompt is stringified before passing to LLM. Stringify in service if needed. |
| User tries to resume `completed` conversation | Med | Low | Service filters `find-or-create` by `completed=false`. New call → new conversation. |
| Premium access check duplicated | Low | Med | Extract `ScenarioService.checkAccess()` if not already a method; reuse. |
| History bloat past 20 turns | Low | Low | Hard cap: query `LIMIT 20 ORDER BY created_at DESC`. |
| Concurrent requests to same conversation | Low | Med | Use conversation-level lock OR accept last-write-wins (chat is inherently sequential per user). |

## Success Metrics
- `/scenario/chat` returns 200 with non-empty `reply` in < 3s p95.
- Opening-turn response is in-character (manual QA across 10 scenarios).
- `completed: true` correctly set at turn 12.
- Resume works: second call with same `conversationId` appends correctly.
- Premium scenarios blocked for non-entitled users with 403.

## Validation Criteria
- Unit tests: service branching (new+empty, new+msg, resume, wrap-up turn, completed reject).
- Integration: full conversation to 12 turns, verify `completed` flag + history persisted.
- Manual QA: 5 scenarios across proficiency levels — AI stays in character, language level appropriate.

## Next Steps & Dependencies
1. Plan phase: feature breakdown (migration, entity, service, controller, prompt, tests, docs).
2. Dependencies: existing `ScenarioService.checkAccess()` (extract if missing), `UserLanguageService.getActiveLanguage(userId)`.
3. Open follow-ups (post-MVP): structured feedback (correction + hint), SSE streaming, scenario-metadata schema enrichment.

## Unresolved Questions
- Does `ScenarioService` currently expose a standalone `checkAccess(userId, scenarioId)` method, or is access logic inlined in list queries only?
- Does `AiConversation` already have a `status` or `completed` column? Need to verify before adding `completed`.
- How does client know which `scenarioId` the user picked? Assume existing `/scenarios` list endpoint returns it — verify.
- Rate-limit for scenario chat: reuse AI endpoint limits (20/min, 100/hr) or separate bucket?
