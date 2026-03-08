# TypeORM & LangChain Research Report

**Date**: 2026-02-28
**Focus**: Migration patterns & structured LLM output for scenario generation

---

## Topic 1: TypeORM Migration Patterns (NestJS)

### Migration File Naming Convention
- **Format**: `{timestamp}-{description}.ts`
- **Timestamp**: Unix milliseconds (13 digits, e.g., `1740100000000`)
- **Export**: Implement `MigrationInterface` with `name` property matching filename

**Example**:
```typescript
export class AddNativeLearningFlags1740200000000 implements MigrationInterface {
  name = 'AddNativeLearningFlags1740200000000';

  public async up(queryRunner: QueryRunner): Promise<void> { ... }
  public async down(queryRunner: QueryRunner): Promise<void> { ... }
}
```

### CREATE TABLE with UUID Primary Key
Use PostgreSQL native syntax in migration:

```typescript
public async up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    CREATE TABLE "onboarding_scenarios" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "profile_json" jsonb NOT NULL,
      "scenarios" jsonb NOT NULL,
      "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

public async down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`DROP TABLE IF EXISTS "onboarding_scenarios"`);
}
```

### Multi-Column Indexes
Two patterns observed in codebase:

**Composite Index**:
```typescript
await queryRunner.query(`
  CREATE INDEX IF NOT EXISTS "IDX_scenario_user_language"
  ON "onboarding_scenarios" ("user_id", "language_id")
`);
```

**Partial Unique Index** (excludes NULLs):
```typescript
await queryRunner.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_unique"
  ON "users" ("google_provider_id")
  WHERE "google_provider_id" IS NOT NULL
`);
```

---

## Topic 2: LangChain Structured Output (Node.js)

### Prompting for JSON Arrays
LangChain doesn't enforce JSON via `JsonOutputParser` in v1.2.16. Instead, prompt the LLM explicitly and parse manually.

**Pattern**:
```typescript
const prompt = this.promptLoader.loadPrompt('scenario-prompt', {
  userProfile: JSON.stringify(profile),
  nativeLanguage: 'English',
  targetLanguage: 'Spanish',
});

// Request JSON in prompt text
// Example prompt content:
// "Generate 3 onboarding scenarios as a JSON array: [{ scenario, title, description }]"

const response = await this.llmService.chat([new HumanMessage(prompt)], {
  model: LLMModel.GEMINI_2_0_FLASH,
  metadata: { feature: 'scenario-generation' },
});
```

### JSON Parsing with Fallback
Observed pattern in `learning-agent.service.ts`:

```typescript
private parseJsonResponse<T>(response: string, fallback: T): T {
  try {
    // Extract from markdown code blocks (models often wrap JSON)
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
    return JSON.parse(jsonStr) as T;
  } catch (error) {
    this.logger.warn('Failed to parse LLM JSON response', { response, error });
    return fallback; // Return safe default structure
  }
}
```

**Best practices**:
1. Always provide fallback object matching expected schema
2. Handle markdown code blocks (models wrap JSON in ` ```json ... ``` `)
3. Log parsing failures for debugging
4. Use generic `<T>` for type safety

### Passing Profile Objects to Prompts
Use `PromptLoaderService` pattern (confirmed in codebase):

```typescript
// In prompt loader service:
loadPrompt(name: string, variables: Record<string, string> = {}): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}

// In service using it:
const systemPrompt = this.promptLoader.loadPrompt('scenario-generation', {
  userProfile: JSON.stringify({
    nativeLanguage: 'English',
    learningLanguage: 'Spanish',
    proficiencyLevel: 'beginner',
  }),
  scenarioCount: '3',
  context: 'forgot-password-recovery',
});
```

**Prompt template** (`scenario-generation.md`):
```
User Profile:
{{userProfile}}

Generate {{scenarioCount}} onboarding scenarios for {{context}}.

Return as valid JSON array:
[{ scenario: string, title: string, description: string }]
```

---

## Summary: Key Implementation Patterns

| Pattern | Usage |
|---------|-------|
| Migration naming | `{timestamp}-{description}.ts` with `MigrationInterface` |
| UUID PK | `DEFAULT gen_random_uuid()` in PostgreSQL |
| Multi-column index | Use composite or partial indices with WHERE clauses |
| LangChain JSON | Prompt explicitly, parse manually with markdown extraction |
| Error handling | Try/catch with type-safe fallback object |
| Profile to prompt | Serialize to JSON string, substitute via `{{variable}}` |

---

## Unresolved Questions

- Does the current codebase use JSON schema validation for LLM outputs? (May want to add `zod` for strict parsing)
- Should we use `uuid` type in TypeORM entities or keep migrations PostgreSQL-native?
