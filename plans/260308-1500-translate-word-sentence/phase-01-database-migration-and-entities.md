# Phase 1: Database Migration & Entities

## Context Links
- [Plan overview](plan.md)
- [Brainstorm report](../reports/brainstorm-260308-1500-translate-word-sentence.md)
- Entity patterns: `src/database/entities/subscription.entity.ts`
- Migration patterns: `src/database/migrations/1740200000000-add-native-learning-flags-to-languages.ts`

## Overview
- **Priority:** High (blocks all other phases)
- **Status:** Complete
- **Description:** Create vocabulary entity + migration, add translation columns to ai_conversation_messages
- **Completed:** 2026-03-08

## Key Insights
- Follow existing TypeORM entity pattern (uuid PK, snake_case columns, timestamptz)
- Migration uses raw SQL (project pattern)
- Vocabulary needs UNIQUE constraint for upsert support
- ai_conversation_messages already has jsonb metadata but user chose dedicated columns

## Requirements
- New `vocabulary` table with user FK
- Two new nullable columns on `ai_conversation_messages`
- Proper up/down migration methods
- RLS policy for vocabulary table (user data isolation)

## Architecture
```
vocabulary (new)
├── id: uuid PK
├── user_id: uuid FK → users (CASCADE)
├── word: varchar(255)
├── translation: varchar(255)
├── source_lang: varchar(10)
├── target_lang: varchar(10)
├── part_of_speech: varchar(50) nullable
├── pronunciation: varchar(255) nullable
└── created_at: timestamptz

ai_conversation_messages (alter)
├── translated_content: text nullable (NEW)
└── translated_lang: varchar(10) nullable (NEW)
```

## Related Code Files

**Create:**
- `src/database/entities/vocabulary.entity.ts`
- `src/database/migrations/1740300000000-create-vocabulary-and-add-translation-columns.ts`

**Modify:**
- `src/database/entities/ai-conversation-message.entity.ts` — add 2 columns
- `src/database/entities/index.ts` — export Vocabulary

## Implementation Steps

1. Create `vocabulary.entity.ts`:
   - UUID PK, ManyToOne → User with CASCADE
   - Columns: word, translation, sourceLang, targetLang, partOfSpeech (nullable), pronunciation (nullable)
   - `@Unique(['userId', 'word', 'sourceLang', 'targetLang'])` decorator
   - CreateDateColumn for createdAt

2. Update `ai-conversation-message.entity.ts`:
   - Add `translatedContent` column (text, nullable)
   - Add `translatedLang` column (varchar(10), nullable)

3. Update `src/database/entities/index.ts`:
   - Add `export * from './vocabulary.entity'`

4. Create migration `1740300000000-create-vocabulary-and-add-translation-columns.ts`:
   - UP: CREATE TABLE vocabulary with all columns + unique constraint + index on user_id
   - UP: ALTER ai_conversation_messages ADD translated_content, translated_lang
   - UP: RLS policy for vocabulary (user can only access own rows)
   - DOWN: DROP TABLE vocabulary, DROP columns from ai_conversation_messages

## Todo List
- [x] Create vocabulary entity
- [x] Add columns to ai_conversation_message entity
- [x] Export vocabulary from entities index
- [x] Create migration file
- [x] Verify migration runs: `npm run migration:run`
- [x] Verify build: `npm run build`

## Success Criteria
- Migration runs without errors
- Entity matches DB schema
- Build compiles successfully
- `npm run migration:revert` works cleanly

## Risk Assessment
- Unique constraint: ON CONFLICT needed for upsert — handled in service layer
- Column additions are nullable so no data migration needed

## Security Considerations
- RLS policy: users can only CRUD their own vocabulary
- CASCADE on user delete removes vocabulary

## Next Steps
→ Phase 2: Translation service + prompts
