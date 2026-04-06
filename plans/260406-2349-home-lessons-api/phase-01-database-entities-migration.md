# Phase 1: Database Entities + Migration

## Context
- [Brainstorm](../reports/brainstorm-260406-2349-home-lessons-api.md)
- Existing patterns: `src/database/entities/*.entity.ts`, `src/database/migrations/*.ts`

## Overview
- **Priority:** High (blocks Phase 2)
- **Status:** completed
- Create 3 new entities + 1 migration + register in database.module.ts

## Files to Create

### 1. `src/database/entities/scenario-category.entity.ts`
```typescript
@Entity('scenario_categories')
export class ScenarioCategory {
  id: uuid PK
  name: varchar(100)
  icon: text, nullable
  orderIndex: int, default 0
  isActive: boolean, default true
  createdAt, updatedAt: timestamptz
}
```

### 2. `src/database/entities/scenario.entity.ts`
```typescript
@Entity('scenarios')
export class Scenario {
  id: uuid PK
  categoryId: uuid FK → scenario_categories
  languageId: uuid FK → languages, NULLABLE  // NULL = all languages
  creatorId: uuid FK → users, NULLABLE        // KOL future
  giftCode: varchar(50), NULLABLE, UNIQUE     // gift link future
  title: varchar(255)
  description: text, nullable
  imageUrl: text, nullable
  difficulty: enum ScenarioDifficulty (beginner/intermediate/advanced)
  isPremium: boolean, default false
  isTrial: boolean, default false
  isActive: boolean, default true
  orderIndex: int, default 0
  createdAt, updatedAt: timestamptz
}
```

Relations: ManyToOne → ScenarioCategory, Language (nullable), User (nullable as creator)

### 3. `src/database/entities/user-scenario-access.entity.ts`
```typescript
@Entity('user_scenario_access')
@Unique(['userId', 'scenarioId'])
export class UserScenarioAccess {
  id: uuid PK
  userId: uuid FK → users
  scenarioId: uuid FK → scenarios
  grantedAt: timestamptz, default now
}
```

### 4. Migration: `src/database/migrations/1775500000000-create-scenarios-tables.ts`

Migration naming follows existing pattern (timestamp prefix).

```sql
-- UP
CREATE TYPE scenario_difficulty AS ENUM ('beginner', 'intermediate', 'advanced');

CREATE TABLE scenario_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  icon TEXT,
  order_index INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES scenario_categories(id) ON DELETE CASCADE,
  language_id UUID REFERENCES languages(id) ON DELETE SET NULL,
  creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  gift_code VARCHAR(50) UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  image_url TEXT,
  difficulty scenario_difficulty NOT NULL DEFAULT 'beginner',
  is_premium BOOLEAN NOT NULL DEFAULT false,
  is_trial BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_scenario_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, scenario_id)
);

-- Indexes for query performance
CREATE INDEX idx_scenarios_category ON scenarios(category_id);
CREATE INDEX idx_scenarios_language ON scenarios(language_id);
CREATE INDEX idx_scenarios_difficulty ON scenarios(difficulty);
CREATE INDEX idx_scenarios_active ON scenarios(is_active);
CREATE INDEX idx_user_scenario_access_user ON user_scenario_access(user_id);
```

### 5. Modify `src/database/database.module.ts`
Add imports + register `ScenarioCategory`, `Scenario`, `UserScenarioAccess` in entities array.

## Implementation Steps
1. Create `scenario-category.entity.ts`
2. Create `scenario.entity.ts` with relations
3. Create `user-scenario-access.entity.ts`
4. Register all 3 in `database.module.ts` entities array
5. Create migration with up/down methods
6. Run `npm run build` to verify compilation

## Todo
- [x] ScenarioCategory entity
- [x] Scenario entity
- [x] UserScenarioAccess entity
- [x] Register in database.module.ts
- [x] Migration file
- [x] Build check passes

## Success Criteria
- `npm run build` passes
- Migration runs without errors
- All 3 entities registered in both database.module.ts and lesson.module.ts (Phase 2)
