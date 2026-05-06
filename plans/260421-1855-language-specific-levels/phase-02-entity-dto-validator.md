# Phase 2 — Entity + DTO + Custom Validator

## Context Links
- Brainstorm: `plans/reports/brainstorm-260421-1846-language-specific-levels.md` §4, §5
- Phase 1 registry: `src/common/constants/language-levels.ts`

## Overview
- Priority: P1
- Status: completed
- Effort: 45m
- Brief: Update entities to drop enum, widen DTO typing, introduce `@IsValidLevelForLanguage` validator. After this phase, backend still compiles but migration has not yet run — handle with non-breaking column definition.

## Key Insights
- TypeORM entity column type change is metadata only at this stage (migration in phase 3 applies the DDL).
- Custom validator must be async (DB lookup for language's framework) — use `ValidatorConstraint` with injected TypeORM DataSource via `useContainer`.
- `ProficiencyLevel` enum is removed outright — no deprecated alias (YAGNI).

## Requirements

**Functional**
- `language.entity.ts`: add `levelFramework: string | null` (column `level_framework`, VARCHAR(16), nullable).
- `user-language.entity.ts`: `proficiencyLevel: string` (was enum), VARCHAR(16). Drop `ProficiencyLevel` enum export.
- `AddUserLanguageDto` / `UpdateUserLanguageDto` / `SetNativeLanguageDto`: `proficiencyLevel` becomes `string` with `@IsString()` + `@Length(1, 16)` + `@IsValidLevelForLanguage('languageId')`.
- `UserLanguageDto` (response): add `levelFramework: string | null`.
- Custom validator `@IsValidLevelForLanguage(propertyName)`:
  - Reads sibling field `languageId` on the DTO
  - Looks up `languages.level_framework` via DataSource
  - If framework null → accept any string (vi/th case)
  - Else call `isValidLevel(framework, value)` — pass/fail
  - Error message: `"Invalid level '{value}' for language. Valid values: {list}"`

**Non-functional**
- Backend compiles (`npm run build`) after this phase.
- Validator does not crash when `languageId` missing (let `@IsUUID` catch that separately).

## Architecture
Async class-validator constraint registered globally via `useContainer(app.select(AppModule))` (already set up in `main.ts` — verify). Constraint class receives `DataSource` via `@Inject`.

## Related Code Files

**Create**
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/common/validators/is-valid-level-for-language.validator.ts`

**Modify**
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/database/entities/language.entity.ts` — add `levelFramework` column
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/database/entities/user-language.entity.ts` — drop enum, switch column type
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/modules/language/dto/add-user-language.dto.ts`
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/modules/language/dto/update-user-language.dto.ts`
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/modules/language/dto/user-language.dto.ts`
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/modules/language/dto/set-native-language.dto.ts` (if it exposes proficiency)
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/modules/ai/dto/chat.dto.ts` — relax `proficiencyLevel` from enum to `@IsString()`
- Grep for any other `ProficiencyLevel` enum import — replace with `string`

**Delete**
- None (enum removed inline from `user-language.entity.ts`)

## Implementation Steps

1. Grep codebase for `ProficiencyLevel` — catalog every consumer.
2. `language.entity.ts`: add `@Column({ name: 'level_framework', type: 'varchar', length: 16, nullable: true }) levelFramework: string | null`.
3. `user-language.entity.ts`:
   - Delete `export enum ProficiencyLevel`
   - Change column to `@Column({ name: 'proficiency_level', type: 'varchar', length: 16 }) proficiencyLevel: string`
4. Create validator file (kebab-case): `is-valid-level-for-language.validator.ts`
   - `@ValidatorConstraint({ async: true })` class `IsValidLevelForLanguageConstraint`
   - Constructor injects `DataSource`
   - `validate(value, args)`: reads `args.object[args.constraints[0]]` for languageId; queries `languages` repo by id; applies `isValidLevel` from phase 1
   - Export `IsValidLevelForLanguage(propertyName, options?)` decorator factory
5. Update DTOs:
   - `AddUserLanguageDto.proficiencyLevel`: `@IsString() @Length(1, 16) @IsValidLevelForLanguage('languageId') proficiencyLevel?: string`
   - `UpdateUserLanguageDto.proficiencyLevel`: same, `@IsOptional()`
   - `UserLanguageDto`: add `levelFramework: string | null`
   - `chat.dto.ts`: replace `@IsEnum(ProficiencyLevel)` with `@IsString() @Length(1, 16)`
6. Replace all remaining `ProficiencyLevel` imports with plain `string`.
7. Run `npm run build` — fix type errors until clean.

## Todo List
- [ ] Grep & catalog `ProficiencyLevel` consumers
- [ ] Entity: add `levelFramework` to `language.entity.ts`
- [ ] Entity: convert `proficiencyLevel` to string in `user-language.entity.ts`, delete enum
- [ ] Create `is-valid-level-for-language.validator.ts`
- [ ] Update `AddUserLanguageDto`, `UpdateUserLanguageDto`
- [ ] Update `UserLanguageDto` response shape
- [ ] Update `chat.dto.ts` (relax enum)
- [ ] Replace stray `ProficiencyLevel` imports
- [ ] `npm run build` passes

## Success Criteria
- `grep -r "ProficiencyLevel" src/` returns 0 hits.
- `npm run build` exits 0.
- Validator unit-testable (can mock DataSource).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Async validator not invoked (useContainer missing) | Low | High | Verify `main.ts` has `useContainer(app.select(AppModule), { fallbackOnErrors: true })` before migrating |
| DataSource DI into validator fails | Medium | High | Register constraint class as provider in `CommonModule` or `LanguageModule`; prefer global module |
| Langfuse prompt version bump needed for `chat.dto.ts` widening | Unknown | Low | **Verify before merging** — see plan.md unresolved Qs |

## Security Considerations
- Validator is user-input gate. Must reject unknown levels with 400 — `AllExceptionsFilter` handles formatting.
- Error message exposes valid values — acceptable (not secret).
- Null-framework languages (vi/th) accept any string — document behavior; not a privilege-escalation risk.

## Next Steps
- Phase 3 runs migration to make entity/DB align.
- Phase 4 wires service to call registry helpers on create/update.
