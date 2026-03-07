# Phase 1: Database Migration & Entity Update

## Context Links

- [Brainstorm report](../reports/brainstorm-260228-1645-language-selection-native-learning-flags.md)
- Entity: `src/database/entities/language.entity.ts`
- Migration pattern: `src/database/migrations/1738678400000-add-flag-url-to-languages.ts`

## Overview

- **Priority:** P1 (blocks all other phases)
- **Status:** pending
- **Description:** Add `is_native_available` and `is_learning_available` boolean columns to `languages` table. Update Language entity to match.

## Key Insights

- Existing `Language` entity uses `is_active` boolean with `default: true` -- same pattern
- Migration naming: `{timestamp}-{kebab-description}.ts` with class name `PascalDescription{Timestamp}`
- Latest migration timestamp: `1740100000000` -- use `1740200000000`
- `DEFAULT true` ensures all existing languages remain available for both native and learning

## Requirements

**Functional:**
- New columns must default to `true`
- Existing data unaffected

**Non-functional:**
- Migration must be reversible (proper `down()` method)
- Entity must match DB schema exactly

## Architecture

Simple additive schema change:
```
languages table
  + is_native_available BOOLEAN DEFAULT true NOT NULL
  + is_learning_available BOOLEAN DEFAULT true NOT NULL
```

## Related Code Files

| Action | File |
|--------|------|
| Create | `src/database/migrations/1740200000000-add-native-learning-flags-to-languages.ts` |
| Modify | `src/database/entities/language.entity.ts` |

## Implementation Steps

### 1. Create migration file

Create `src/database/migrations/1740200000000-add-native-learning-flags-to-languages.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNativeLearningFlagsToLanguages1740200000000
  implements MigrationInterface
{
  name = 'AddNativeLearningFlagsToLanguages1740200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "languages"
      ADD COLUMN "is_native_available" BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN "is_learning_available" BOOLEAN NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "languages"
      DROP COLUMN "is_native_available",
      DROP COLUMN "is_learning_available"
    `);
  }
}
```

### 2. Update Language entity

Add two fields to `src/database/entities/language.entity.ts` after the `isActive` field:

```typescript
@Column({ type: 'boolean', name: 'is_native_available', default: true })
isNativeAvailable!: boolean;

@Column({ type: 'boolean', name: 'is_learning_available', default: true })
isLearningAvailable!: boolean;
```

Full entity after changes:

```typescript
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('languages')
export class Language {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 10, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 100, name: 'native_name', nullable: true })
  nativeName?: string;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ type: 'boolean', name: 'is_native_available', default: true })
  isNativeAvailable!: boolean;

  @Column({ type: 'boolean', name: 'is_learning_available', default: true })
  isLearningAvailable!: boolean;

  @Column({ type: 'text', name: 'flag_url', nullable: true })
  flagUrl?: string;
}
```

### 3. Verify build

Run `npm run build` to ensure entity compiles.

## Todo List

- [ ] Create migration file `1740200000000-add-native-learning-flags-to-languages.ts`
- [ ] Update `language.entity.ts` with 2 new boolean fields
- [ ] Verify `npm run build` succeeds

## Success Criteria

- Migration creates 2 columns with correct types and defaults
- Migration `down()` removes both columns
- Entity fields map to correct DB column names
- Build passes with no errors

## Risk Assessment

- **Risk:** Column name collision -- mitigated: checked entity, no conflicts
- **Risk:** Migration order -- mitigated: timestamp `1740200000000` > all existing

## Security Considerations

- No security implications -- additive read-only flags
- RLS policies unaffected (these are catalog-level columns, not user-scoped)

## Next Steps

- Phase 2: Update DTOs to expose new flags
