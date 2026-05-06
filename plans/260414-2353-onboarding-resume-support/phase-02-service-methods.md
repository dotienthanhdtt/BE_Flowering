# Phase 02 — Service Methods

## Context Links

- Service: `src/modules/onboarding/onboarding.service.ts`
- Entity: `src/database/entities/ai-conversation.entity.ts` (updated in phase-01)
- Plan: `plan.md`

## Overview

- Priority: P1
- Status: pending
- Add `getMessages(conversationId)` method.
- Make `complete(dto)` idempotent via cached `extractedProfile` + `scenarios`.

## Key Insights

- `getMessages` can reuse `findValidSession` guard (enforces ANONYMOUS filter) → prevents exposing authenticated conversations via this endpoint.
- Turn-number formula matches `chat()`: `msgCount === 0 ? 0 : Math.floor((msgCount - 1) / 2) + 1`.
- **Cache gate** for `complete`: only write cache when profile is a real structured object (not `{raw: ...}` fallback) AND `scenarios.length === 5`. Prevents sticky empty-scenarios state.

## Requirements

**Functional:**
- `getMessages(convId)` returns `{ conversationId, turnNumber, maxTurns, isLastTurn, messages: [{id, role, content, createdAt}] }`.
- Messages ordered ASC by `createdAt`.
- `findValidSession` filters `type = ANONYMOUS` — non-anonymous convs return 404.
- `complete` on 2nd call returns cached data, does NOT invoke LLM.
- Failed generations do NOT poison cache.

**Non-functional:**
- Second `/complete` response < 50ms (cache hit, no LLM).
- Cache invariant: if `extractedProfile` cached, `scenarios` also cached — both written atomically.

## Architecture

```
complete(dto)
  ├─ findValidSession
  ├─ if conv.extractedProfile && conv.scenarios?.length === 5:
  │    return cached                       ← hot path
  ├─ else: extract profile (LLM)
  │        generate scenarios (LLM)
  │        if profile is structured AND scenarios.length === 5:
  │          conversationRepo.update(id, { extractedProfile, scenarios })
  │        return { ...profile, scenarios }

getMessages(convId)
  ├─ findValidSession(convId)              ← 404 if missing/non-anonymous
  ├─ messageRepo.find ordered ASC
  ├─ compute turnNumber from messageCount
  └─ return { conversationId, turnNumber, maxTurns, isLastTurn, messages: [...] }
```

## Related Code Files

**Modify:** `src/modules/onboarding/onboarding.service.ts`

## Implementation Steps

### Step 1 — Add `getMessages` method (public)

```ts
async getMessages(conversationId: string): Promise<{
  conversationId: string;
  turnNumber: number;
  maxTurns: number;
  isLastTurn: boolean;
  messages: Array<{ id: string; role: MessageRole; content: string; createdAt: Date }>;
}> {
  const conversation = await this.findValidSession(conversationId);
  const rows = await this.messageRepo.find({
    where: { conversationId: conversation.id },
    order: { createdAt: 'ASC' },
  });

  const msgCount = conversation.messageCount;
  const turnNumber = msgCount === 0 ? 0 : Math.floor((msgCount - 1) / 2) + 1;
  const isLastTurn = turnNumber >= onboardingConfig.maxTurns;

  return {
    conversationId: conversation.id,
    turnNumber,
    maxTurns: onboardingConfig.maxTurns,
    isLastTurn,
    messages: rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt,
    })),
  };
}
```

**Important:** Return only `id`, `role`, `content`, `createdAt`. Omit `metadata`, `audioUrl`, `translatedContent`, `translatedLang`.

### Step 2 — Modify `complete` for idempotency

```ts
async complete(dto: OnboardingCompleteDto) {
  const conversation = await this.findValidSession(dto.conversationId);

  // Cache hit: both profile AND 5 scenarios cached
  if (
    conversation.extractedProfile &&
    Array.isArray(conversation.scenarios) &&
    conversation.scenarios.length === 5
  ) {
    return {
      ...(conversation.extractedProfile as Record<string, unknown>),
      scenarios: conversation.scenarios as OnboardingScenarioDto[],
    };
  }

  // Cache miss: extract + generate
  const messages = await this.messageRepo.find({
    where: { conversationId: conversation.id },
    order: { createdAt: 'ASC' },
  });
  const transcript = messages.map((m) => `${m.role}: ${m.content}`).join('\n');

  const extractionPrompt = this.promptLoader.loadPrompt('onboarding-extraction-prompt.md', {
    transcript,
  });
  const response = await this.llmService.chat([new HumanMessage(extractionPrompt)], {
    model: onboardingConfig.llmModel,
    temperature: 0,
    maxTokens: 512,
    metadata: { feature: 'onboarding-extraction', conversationId: conversation.id },
  });

  const profile = this.parseExtraction(response);
  const scenarios = await this.generateScenarios(profile, conversation.id);

  // Cache only structured profile + full 5 scenarios
  const isProfileStructured = !('raw' in profile) && Object.keys(profile).length > 0;
  if (isProfileStructured && scenarios.length === 5) {
    await this.conversationRepo.update(conversation.id, {
      extractedProfile: profile,
      scenarios: scenarios as unknown as Array<Record<string, unknown>>,
    });
  }

  return { ...profile, scenarios };
}
```

### Step 3 — Compile check

Run `npm run build` → no TS errors.

## Todo List

- [ ] Add `getMessages` method w/ ANONYMOUS filter + ASC ordering
- [ ] Modify `complete` w/ cache read at top
- [ ] Add cache-write gate (structured profile + 5 scenarios)
- [ ] `npm run build` passes
- [ ] Verify types: `extractedProfile` / `scenarios` match entity signature

## Success Criteria

- `getMessages(convId)` returns full transcript, filtered to ANONYMOUS only.
- Non-existent or AUTHENTICATED convId throws `NotFoundException`.
- Second `complete(sameId)` does NOT call `llmService.chat` (verified in Phase 04 tests).
- Second `complete(sameId)` returns scenarios with identical UUIDs to first call.
- Partial failure (profile OK, scenarios empty) → no cache write, retry works.

## Risk Assessment

- **Risk:** Race condition — two `/complete` calls in parallel both miss cache, both run LLM, last write wins. **Impact:** Minor — mobile sends sequentially; even if raced, scenarios may differ once but stabilize on 3rd call. **Mitigation:** accept; explicit lock is over-engineering for onboarding.
- **Risk:** Cached `scenarios` JSONB loses class-transformer metadata (e.g., enum validation). **Mitigation:** `OnboardingScenarioDto` fields are plain strings/uuids — no Date/nested classes. Safe as JSON.
- **Risk:** `{raw: response}` fallback may still satisfy the truthy check if cache read logic is wrong. **Mitigation:** Explicit `Array.isArray(scenarios) && scenarios.length === 5` gate — won't pass w/o real scenarios.

## Security Considerations

- `getMessages` uses existing ANONYMOUS filter — cannot leak authenticated conversation messages.
- Returned message fields are minimal (`id`, `role`, `content`, `createdAt`). No `metadata`, no cost/token fields.

## Next Steps

Phase 03 wires the controller endpoint + DTO.
