# Brainstorm: Home Screen Lessons API

**Date:** 2026-04-06
**Branch:** feat/implement-home
**Status:** Approved

## Problem Statement

Need `GET /lessons` API for home screen. Returns scenarios grouped by category with filtering by level, language, search. Scenarios have complex visibility rules: global, language-specific, or user-specific (gifted). Future KOL/KOC can create scenarios shared via gift links.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Entity model | New Scenario + ScenarioCategory (separate from Lesson) | Lesson = exercise container, Scenario = browsable content unit |
| Language scope | Nullable `language_id` (NULL = all languages) | Simplest model, no join table, covers 90% of cases |
| Status logic | Computed at query time | Stays in sync with subscription changes automatically |
| KOL/KOC | Schema-ready (creator_id + gift_code nullable) | Flexibility without building full system |
| Response shape | Grouped by category | Flutter renders sections directly |
| Level filter | Scenario's own difficulty field | User explicitly filters by beginner/intermediate/advanced |
| Pagination | Offset (page/limit) | Simple, good enough for home screen |

## New Entities

### ScenarioCategory
```
scenario_categories
├── id (uuid, PK)
├── name (varchar 100)
├── icon (text, nullable)
├── order_index (int, default 0)
├── is_active (boolean, default true)
├── created_at, updated_at
```

### Scenario
```
scenarios
├── id (uuid, PK)
├── category_id (uuid, FK → scenario_categories)
├── language_id (uuid, FK → languages, NULLABLE) — NULL = all languages
├── creator_id (uuid, FK → users, NULLABLE) — KOL/KOC future
├── gift_code (varchar 50, NULLABLE, UNIQUE) — gift link future
├── title (varchar 255)
├── description (text, nullable)
├── image_url (text, nullable)
├── difficulty (enum: beginner/intermediate/advanced)
├── is_premium (boolean, default false)
├── is_trial (boolean, default false)
├── is_active (boolean, default true)
├── order_index (int, default 0)
├── created_at, updated_at
```

### UserScenarioAccess
```
user_scenario_access
├── id (uuid, PK)
├── user_id (uuid, FK → users)
├── scenario_id (uuid, FK → scenarios)
├── granted_at (timestamptz)
├── UNIQUE(user_id, scenario_id)
```

## Core Query Logic

```sql
WHERE scenario.is_active = true
  AND (
    scenario.language_id IS NULL                          -- global
    OR scenario.language_id = :languageId                 -- language-specific
    OR scenario.id IN (                                   -- personal access
        SELECT scenario_id FROM user_scenario_access
        WHERE user_id = :userId
    )
  )
  AND (scenario.difficulty = :level OR :level IS NULL)
  AND (scenario.title ILIKE '%:search%' OR :search IS NULL)
```

## Status Computation

```
if user_progress.status = 'completed'  → "learned"
if scenario.is_premium AND user.plan = FREE AND NOT is_trial → "locked"
if scenario.is_trial = true AND user.plan = FREE → "trial"
else → "available"
```

Priority: learned > locked > trial > available

## API Contract

**Request:** `GET /lessons?language=<uuid>&level=beginner&search=coffee&page=1&limit=20`

**Response:**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "categories": [
      {
        "id": "uuid",
        "name": "Daily Conversation",
        "icon": "chat-bubble",
        "scenarios": [
          {
            "id": "uuid",
            "title": "Ordering Coffee",
            "imageUrl": "https://...",
            "difficulty": "beginner",
            "status": "available"
          }
        ]
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 45 }
  }
}
```

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/database/entities/scenario-category.entity.ts` |
| Create | `src/database/entities/scenario.entity.ts` |
| Create | `src/database/entities/user-scenario-access.entity.ts` |
| Modify | `src/database/database.module.ts` (register 3 entities) |
| Create | `src/modules/lesson/lesson.module.ts` |
| Create | `src/modules/lesson/lesson.controller.ts` |
| Create | `src/modules/lesson/lesson.service.ts` |
| Create | `src/modules/lesson/dto/get-lessons.dto.ts` |
| Create | Migration file |

## Next Steps

Create implementation plan via `/ck:plan`.
