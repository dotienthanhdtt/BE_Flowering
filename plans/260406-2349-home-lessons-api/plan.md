---
status: completed
branch: feat/implement-home
brainstorm: plans/reports/brainstorm-260406-2349-home-lessons-api.md
blockedBy: []
blocks: []
completedAt: 2026-04-06
---

# Home Screen Lessons API

## Overview
Implement `GET /lessons` API returni`ng scenarios grouped by category with visibility rules (global, language-specific, user-specific) and computed status (available/trial/locked/learned).

## Phases

| # | Phase | Status | Effort |
|---|-------|--------|--------|
| 1 | Database entities + migration | completed | M |
| 2 | Lesson module (controller + service + DTOs) | completed | L |
| 3 | Testing | completed | M |

## Key Dependencies
- Existing: `User`, `Language`, `Subscription`, `UserProgress` entities
- New: `ScenarioCategory`, `Scenario`, `UserScenarioAccess` entities

## Architecture
``` 
GET /lessons?language=uuid&level=beginner&search=text&page=1&limit=20

→ LessonController.getLessons()
  → LessonService.findScenariosByCategory()
    → QueryBuilder: visibility filter + difficulty + search
    → Status computation: subscription + progress lookup
    → Group by category, return paginated
```

## Phase Files
- [Phase 1: Database](./phase-01-database-entities-migration.md)
- [Phase 2: Lesson Module](./phase-02-lesson-module.md)
- [Phase 3: Testing](./phase-03-testing.md)
