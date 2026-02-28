---
status: completed
---

**Parent plan:** [plan.md](./plan.md)
**Research:** [researcher-typeorm-langchain-report.md](./reports/researcher-typeorm-langchain-report.md)
**Source:** `src/modules/onboarding/onboarding.service.ts`, `src/modules/ai/services/unified-llm.service.ts`

---

# Phase 04: Onboarding Complete — Scenarios Generation

**Priority:** P1 | **Status:** completed | **Est:** 1h
**Independent of Phase 03** — can run in parallel

## Overview

Extend `POST /onboarding/complete` to return 5 AI-generated personalized scenario cards alongside the existing profile extraction. Uses a separate LLM call after profile extraction, with no DB storage (generate-and-return only).

## Key Insights (from reading onboarding.service.ts)

- `complete()` currently calls `llmService.chat()` then `parseExtraction(response)` — returns the parsed object directly
- `parseExtraction()` handles both raw JSON and JSON-in-markdown-blocks — reuse this pattern
- `promptLoader.loadPrompt(name, vars)` uses `{{variable}}` substitution from `.md` files in `src/modules/ai/prompts/`
- `llmService.chat()` takes `BaseMessage[]` and options `{ model, temperature, maxTokens, metadata }`
- `UnifiedLLMService` and `PromptLoaderService` are already injected — no new dependencies needed
- Scenarios IDs: generate server-side with `randomUUID()` (already imported: `import { randomUUID } from 'crypto'`)

## Architecture

### Extended `complete()` Flow

```
complete(dto):
  1. findValidSession(dto.sessionToken)
  2. load messages from DB → build transcript
  3. LLM call 1: profile extraction (existing)
  4. parse profile → ExtractedProfile object
  5. LLM call 2: generateScenarios(profile) [NEW]
  6. return { ...profile, scenarios }
```

### Scenario DTO

```ts
interface ScenarioDto {
  id: string;           // UUID v4 (server-generated)
  title: string;        // short title
  description: string;  // 1-2 sentences
  icon: string;         // Lucide icon name
  accentColor: 'primary' | 'blue' | 'green' | 'lavender' | 'rose';
}
```

### Prompt Design (onboarding-scenarios-prompt.md)

Key constraints for the LLM:
- Exactly 5 scenarios
- `icon` must be from a pre-defined list of valid Lucide names
- `accentColor` must be exactly one of: primary, blue, green, lavender, rose
- Return pure JSON array (no markdown blocks)
- Vary accentColors across the 5 scenarios

## Related Code Files

### New files
- `src/modules/onboarding/dto/onboarding-scenario.dto.ts` — ScenarioDto class
- `src/modules/ai/prompts/onboarding-scenarios-prompt.md` — LLM prompt template

### Modified files
- `src/modules/onboarding/onboarding.service.ts` — extend `complete()`, add `generateScenarios()`
- `src/modules/onboarding/dto/index.ts` — export ScenarioDto

## Implementation Steps

### Step 1: Create `onboarding-scenario.dto.ts`

```ts
import { IsEnum, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export type ScenarioAccentColor = 'primary' | 'blue' | 'green' | 'lavender' | 'rose';

export class OnboardingScenarioDto {
  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty({ example: 'briefcase' })
  @IsString()
  icon: string;

  @ApiProperty({ enum: ['primary', 'blue', 'green', 'lavender', 'rose'] })
  @IsEnum(['primary', 'blue', 'green', 'lavender', 'rose'])
  accentColor: ScenarioAccentColor;
}
```

### Step 2: Create prompt `onboarding-scenarios-prompt.md`

```markdown
You are a language learning scenario designer. Generate exactly 5 personalized practice scenarios for this learner.

Learner Profile:
- Native language: {{nativeLanguage}}
- Target language: {{targetLanguage}}
- Current level: {{currentLevel}}
- Learning goals: {{learningGoals}}
- Preferred topics: {{preferredTopics}}

Return ONLY a valid JSON array with exactly 5 objects. No markdown, no explanation.

Each object must have exactly these fields:
- "title": short scenario title (5-8 words)
- "description": 1-2 sentences describing what the learner will practice
- "icon": one of: briefcase, coffee, globe, book, mic, headphones, users, shopping-cart, plane, utensils, heart, home, star, zap, camera
- "accentColor": one of: primary, blue, green, lavender, rose (use each at least once across the 5)

Example:
[{"title":"...","description":"...","icon":"briefcase","accentColor":"primary"},...]
```

### Step 3: Update `onboarding.service.ts`

Add import at top:
```ts
import { OnboardingScenarioDto } from './dto/onboarding-scenario.dto';
```

Replace `complete()` method:
```ts
async complete(dto: OnboardingCompleteDto) {
  const conversation = await this.findValidSession(dto.sessionToken);
  const messages = await this.messageRepo.find({
    where: { conversationId: conversation.id },
    order: { createdAt: 'ASC' },
  });

  const transcript = messages.map((m) => `${m.role}: ${m.content}`).join('\n');

  // Step 1: Extract profile (existing logic)
  const extractionPrompt = this.promptLoader.loadPrompt(
    'onboarding-extraction-prompt',
    { transcript },
  );
  const extractionResponse = await this.llmService.chat(
    [new HumanMessage(extractionPrompt)],
    {
      model: onboardingConfig.llmModel,
      temperature: 0.1,
      maxTokens: 512,
      metadata: { feature: 'onboarding-extraction', conversationId: conversation.id },
    },
  );

  const profile = this.parseExtraction(extractionResponse);

  // Step 2: Generate scenarios from profile
  const scenarios = await this.generateScenarios(profile, conversation.id);

  return { ...profile, scenarios };
}
```

Add private `generateScenarios()` method:
```ts
private async generateScenarios(
  profile: Record<string, unknown>,
  conversationId: string,
): Promise<OnboardingScenarioDto[]> {
  const scenariosPrompt = this.promptLoader.loadPrompt('onboarding-scenarios-prompt', {
    nativeLanguage: String(profile.nativeLanguage ?? ''),
    targetLanguage: String(profile.targetLanguage ?? ''),
    currentLevel: String(profile.currentLevel ?? ''),
    learningGoals: Array.isArray(profile.learningGoals)
      ? profile.learningGoals.join(', ')
      : String(profile.learningGoals ?? ''),
    preferredTopics: Array.isArray(profile.preferredTopics)
      ? profile.preferredTopics.join(', ')
      : String(profile.preferredTopics ?? ''),
  });

  const response = await this.llmService.chat(
    [new HumanMessage(scenariosPrompt)],
    {
      model: onboardingConfig.llmModel,
      temperature: 0.7,
      maxTokens: 1024,
      metadata: { feature: 'onboarding-scenarios', conversationId },
    },
  );

  return this.parseScenarios(response);
}
```

Add private `parseScenarios()` method:
```ts
private parseScenarios(response: string): OnboardingScenarioDto[] {
  try {
    // Strip markdown code blocks if present
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed) || parsed.length !== 5) {
      throw new Error(`Expected 5 scenarios, got ${Array.isArray(parsed) ? parsed.length : 'non-array'}`);
    }

    return parsed.map((s) => ({
      id: randomUUID(),            // server-generated, not LLM-generated
      title: String(s.title ?? ''),
      description: String(s.description ?? ''),
      icon: String(s.icon ?? 'star'),
      accentColor: (['primary', 'blue', 'green', 'lavender', 'rose'].includes(s.accentColor)
        ? s.accentColor
        : 'primary') as OnboardingScenarioDto['accentColor'],
    }));
  } catch (error) {
    this.logger.error('Failed to parse scenarios JSON', { error, response });
    throw new InternalServerErrorException('Failed to generate scenarios');
  }
}
```

Add `InternalServerErrorException` to `@nestjs/common` imports.

### Step 4: Export from `dto/index.ts`
```ts
export { OnboardingScenarioDto } from './onboarding-scenario.dto';
```

### Step 5: Verify compile
```bash
npm run build
```

## Todo List

- [ ] Create `src/modules/onboarding/dto/onboarding-scenario.dto.ts`
- [ ] Create `src/modules/ai/prompts/onboarding-scenarios-prompt.md`
- [ ] Update `onboarding.service.ts`: replace `complete()` with extended version
- [ ] Add `generateScenarios()` private method
- [ ] Add `parseScenarios()` private method
- [ ] Export `OnboardingScenarioDto` from `dto/index.ts`
- [ ] Verify `npm run build` passes

## Success Criteria

- `POST /onboarding/complete` returns `{ ...profile, scenarios: [5 items] }`
- Each scenario has: id (UUID), title, description, icon, accentColor (valid enum)
- Parse failure throws 500 (no silent truncation or partial arrays)
- No DB writes for scenarios
- `accentColor` always one of the 5 valid tokens

## Risk Assessment

| Risk | Mitigation |
|---|---|
| LLM returns != 5 items | Hard throw InternalServerErrorException with log |
| LLM returns invalid accentColor | Server-side fallback to 'primary' |
| Prompt template variable name mismatch | Use same `{{variable}}` format as existing prompts; test with unit tests |
| Profile fields missing/undefined | Defensive String() casting + Array.isArray checks |
