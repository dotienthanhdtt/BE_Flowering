# Multi-Language Content Architecture — Brainstorm Report

**Date:** 2026-04-18  
**Revised:** 2026-04-18 21:34 (post codebase verification)  
**Feature:** Multi-language app content (lessons, exercises, AI chat, vocabulary, scenarios)

---

## Problem Statement

Users learn different languages (English, Spanish, French, etc.). All content in the app — lessons, exercises, AI chat, scenarios — must be served in the user's active learning language. Vocabulary is bilingual (native + learning language).

**Scope:** 5–10 target learning languages. Content creation: hybrid (AI drafts + human review). Language switch = fresh progress start.

---

## Current State (Verified Against Codebase)

### Already Done ✓
| Entity / Feature | State | Evidence |
|---|---|---|
| `Lesson.languageId` | **Required (NOT NULL)** | `lesson.entity.ts:28` |
| `Vocabulary.sourceLang` / `targetLang` | Bilingual by design | `vocabulary.entity.ts:31-35` |
| `UserLanguage.isActive` | Flag exists | `user-language.entity.ts:47` |
| `AiConversation.languageId` | Nullable FK | `ai-conversation.entity.ts:35` |
| AI chat prompts | Pass `targetLanguage` | `learning-agent.service.ts:44`, `scenario-chat.service.ts:96` |

### Real Gaps
| Entity | Gap |
|---|---|
| `Exercise` | **NO `languageId` field at all** — only `lessonId`. Must JOIN through Lesson OR denormalize |
| `UserProgress` | **NO `languageId`** — links User → Lesson only |
| `UserExerciseAttempt` | **NO `languageId`** — same issue |
| `Scenario.languageId` | Nullable; allows "global" scenarios (`languageId=null`) — strategy needed |
| Request-scoped language | No decorator, guard, or middleware exists |
| Admin content seeding | No endpoints exist |

---

## Evaluated Approaches

### Option A: Language-Partitioned Content ✅ Chosen

Each content row tied to one language. APIs filter by header.

```
lessons:
  id | languageId | title
  1  | en         | "Present Tense"
  2  | es         | "Tiempo Presente"
```

**Pros:** Correct mental model (language lessons are distinct content, not translations). Lesson already built this way.  
**Cons:** Content must be seeded per language. Exercise/Progress need denormalization decisions.

### Option B: Translations Table (i18n pattern) ❌ Rejected

Rejected — language learning content is NOT i18n. Spanish lessons ≠ translated English lessons. Extra JOIN complexity for no real benefit.

---

## Final Architecture

### 1. Active Language Context (New Code)

Mobile sends `X-Learning-Language: es` header per request.

```
X-Learning-Language header
  → @ActiveLanguage() custom param decorator (new)
  → LanguageContextGuard: validates code against user's enrolled UserLanguage (new)
  → Fallback: if header missing → read UserLanguage.isActive from DB
  → Services filter: WHERE languageId = 'es'
```

Files to create:
- `src/common/decorators/active-language.decorator.ts`
- `src/common/guards/language-context.guard.ts`

### 2. Schema Changes (Revised)

| Entity | Change | Reason |
|---|---|---|
| `Lesson.languageId` | **No change** — already required | Already done |
| `Exercise.languageId` | **ADD nullable FK → backfill → make required** | Direct filtering without JOIN; avoids O(N) JOIN cost |
| `UserProgress.languageId` | **ADD required FK** | Progress isolation per language |
| `UserExerciseAttempt.languageId` | **ADD required FK** | Attempt history isolation per language |
| `Scenario.languageId` | **Make NOT NULL** (migrate existing nulls to a default language OR delete them) | Per-language only — no globals |
| `AiConversation.languageId` | **Make NOT NULL always** | Every conversation belongs to a language |

### 3. Scenarios Strategy (Finalized)

**Decision: Per-language only.** No global scenarios.

- `Scenario.languageId` migrates nullable → NOT NULL
- Existing scenarios with `languageId=null` → backfill with default language (e.g., `en`) OR mark as archived
- Query: `WHERE languageId = :active`
- Trade-off: more seeding work (each scenario per language) but cleaner semantics and simpler queries

### 4. Content APIs

All lesson/exercise/scenario controllers inject `@ActiveLanguage()`:

```typescript
@Get('lessons')
getLessons(@ActiveLanguage() lang: string) {
  return this.lessonService.findByLanguage(lang);
}
```

Zero extra DB calls (header is stateless); fallback DB query only fires when header missing.

### 5. Admin Content Seeding (New Module)

```
POST /admin/content/generate
{ languageCode: "es", contentType: "lesson", level: "beginner", count: 10 }
→ LLM generates draft content in Spanish
→ Stored with languageId='es', status='draft'
→ PATCH /admin/content/:id/publish after human review
```

New module: `src/modules/admin-content/` (seeding endpoints, review workflow).

### 6. Progress Isolation Per Language

- `UserProgress.languageId` + `UserExerciseAttempt.languageId` enforce hard isolation
- Language switch via `UserLanguage.isActive` toggle → queries naturally scope to new active language
- No cross-language contamination

### 7. AI Chat (Already Works)

- `learning-agent.service.ts` + `scenario-chat.service.ts` already thread `targetLanguage` into prompts
- Just source `targetLanguage` from `@ActiveLanguage()` header instead of whatever current source is

---

## Implementation Checklist (Revised)

**Phase 1: Request context infrastructure**
- [ ] `@ActiveLanguage()` decorator
- [ ] `LanguageContextGuard` with DB fallback
- [ ] Unit tests for header parsing, validation, fallback

**Phase 2: Schema migrations**
- [ ] Add `Exercise.languageId` (nullable → backfill from Lesson → NOT NULL)
- [ ] Add `UserProgress.languageId` (required FK + index)
- [ ] Add `UserExerciseAttempt.languageId` (required FK + index)
- [ ] Decide `AiConversation.languageId` nullable vs required
- [ ] Decide `Scenario.languageId` global-vs-specific strategy

**Phase 3: Service layer filtering**
- [ ] Lesson service: filter by languageId
- [ ] Exercise service: filter by languageId
- [ ] Scenario service: filter by languageId (per-language only, no globals)
- [ ] Progress service: filter by languageId
- [ ] UserLanguage service: set active language

**Phase 4: Controllers**
- [ ] Inject `@ActiveLanguage()` in lesson/exercise/scenario/progress/AI controllers
- [ ] AI chat: source `targetLanguage` from header

**Phase 5: Admin content seeding**
- [ ] `admin-content` module with generate/review/publish endpoints
- [ ] LLM prompts per language
- [ ] Draft/published state machine

**Phase 6: Mobile + launch**
- [ ] Mobile always sends `X-Learning-Language`
- [ ] Seed initial content per launch language
- [ ] E2E test: language switch = isolated data

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Content gap at launch (5–10 languages × N lessons) | Seed pipeline before opening each language; start with 2–3 languages |
| Exercise.languageId backfill breaks if Lesson.languageId has NULLs historically | Verify no NULL lessons exist pre-migration |
| UserProgress/UserExerciseAttempt backfill for existing users | Map existing rows via `lesson.languageId` during migration |
| Mobile forgets header on some endpoints | DB fallback to `UserLanguage.isActive`; log warning for monitoring |
| Scenarios strategy changes later | Keep nullable languageId pattern flexible |

---

## Finalized Decisions (Confirmed with User)

| Question | Decision |
|---|---|
| Scenarios | **Per-language only** — every scenario has `languageId`, no globals |
| Header missing fallback | **DB lookup** — read `UserLanguage.isActive` when `X-Learning-Language` absent |
| AiConversation.languageId | **Always NOT NULL** — every conversation belongs to a language |
| Admin content seeding scope | **Minimal** — generate drafts + manual publish endpoint; review via DB for now |

## Remaining Unresolved Questions

1. **Existing user data migration**: how many existing `UserProgress` / `UserExerciseAttempt` / `AiConversation` / `Scenario` rows with NULL language need backfill? Need count query before migration.
2. **Default backfill language**: for existing rows, backfill with `en`? Or user's first `UserLanguage`? Affects ~3 entities.
3. **Admin auth**: does an admin role/guard exist, or build one? Check existing auth.
4. **Anonymous onboarding**: if `AiConversation.languageId` becomes NOT NULL, how does anonymous flow work? Must set language before first chat message.
