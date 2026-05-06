# Phase 04 — Tests

## Context Links

- Existing specs: `src/modules/onboarding/onboarding.service.spec.ts`, `onboarding.controller.spec.ts`
- Plan: `plan.md`

## Overview

- Priority: P1
- Status: pending
- Unit tests: `getMessages` + idempotent `complete`.
- E2E (optional if suite already covers): POST chat → GET messages → assert transcript; POST complete twice → assert scenarios stable + no 2nd LLM call.

## Key Insights

- `onboarding.service.spec.ts` already mocks `UnifiedLLMService`, `conversationRepo`, `messageRepo`. Extend.
- Assert `llmService.chat` **not called** on 2nd `complete` using `jest.clearAllMocks()` + `expect(llm.chat).not.toHaveBeenCalled()`.

## Requirements

**Unit:**
- `getMessages`: returns ordered transcript; 404 on missing conv; 404 on non-anonymous conv; correct turn_number computed.
- `complete` cache hit: 2nd call with populated `extractedProfile` + 5 `scenarios` returns cached data; `llmService.chat` NOT called.
- `complete` cache write gate: writes cache only when profile is structured AND `scenarios.length === 5`.
- `complete` cache write gate: does NOT write cache when profile is `{raw: ...}` fallback.
- `complete` cache write gate: does NOT write cache when scenarios empty.

**Controller:**
- GET route wired; returns service output; path param validated (invalid UUID → 400).

**E2E (optional):**
- Full HTTP smoke: POST chat → GET messages (assert body matches transcript) → POST complete → POST complete again → assert identical scenario IDs.

## Related Code Files

**Modify:**
- `src/modules/onboarding/onboarding.service.spec.ts` — add `getMessages` + idempotent `complete` blocks.
- `src/modules/onboarding/onboarding.controller.spec.ts` — add test for GET route.

**Create (optional):**
- `test/onboarding-resume.e2e-spec.ts` — if existing E2E doesn't cover. Skip if adding to existing file.

## Implementation Steps

### Step 1 — Service spec additions

Add inside `describe('OnboardingService', ...)`:

```ts
describe('getMessages', () => {
  it('returns messages ordered by createdAt with turn metadata', async () => {
    const conversation = makeConversation({ id: VALID_UUID, messageCount: 3 });
    conversationRepo.findOne.mockResolvedValue(conversation);
    const rows = [
      { id: 'm1', role: 'assistant', content: 'Hi', createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'm2', role: 'user', content: 'Hello', createdAt: new Date('2026-01-01T00:01:00Z') },
      { id: 'm3', role: 'assistant', content: 'Great!', createdAt: new Date('2026-01-01T00:02:00Z') },
    ];
    messageRepo.find.mockResolvedValue(rows);

    const result = await service.getMessages(VALID_UUID);

    expect(result.conversationId).toBe(VALID_UUID);
    expect(result.turnNumber).toBe(2); // (3-1)/2 + 1 = 2
    expect(result.maxTurns).toBe(onboardingConfig.maxTurns);
    expect(result.isLastTurn).toBe(false);
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toEqual({
      id: 'm1', role: 'assistant', content: 'Hi', createdAt: rows[0].createdAt,
    });
    expect(messageRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { createdAt: 'ASC' } }),
    );
  });

  it('returns turnNumber=0 for empty conversation', async () => {
    const conversation = makeConversation({ id: VALID_UUID, messageCount: 0 });
    conversationRepo.findOne.mockResolvedValue(conversation);
    messageRepo.find.mockResolvedValue([]);

    const result = await service.getMessages(VALID_UUID);
    expect(result.turnNumber).toBe(0);
    expect(result.messages).toEqual([]);
  });

  it('throws NotFoundException when conversation missing', async () => {
    conversationRepo.findOne.mockResolvedValue(null);
    await expect(service.getMessages(VALID_UUID)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when conversation is AUTHENTICATED (findValidSession filter)', async () => {
    // findValidSession already filters by type=ANONYMOUS, so null for non-anonymous
    conversationRepo.findOne.mockResolvedValue(null);
    await expect(service.getMessages(VALID_UUID)).rejects.toThrow(NotFoundException);
    expect(conversationRepo.findOne).toHaveBeenCalledWith({
      where: { id: VALID_UUID, type: AiConversationType.ANONYMOUS },
    });
  });
});

describe('complete (idempotency)', () => {
  const cachedProfile = { nativeLanguage: 'English', targetLanguage: 'Spanish', currentLevel: 'A1' };
  const cachedScenarios = Array.from({ length: 5 }, (_, i) => ({
    id: `scenario-uuid-${i}`,
    title: `T${i}`,
    description: `D${i}`,
    icon: 'star',
    accentColor: 'primary',
  }));

  it('returns cached profile + scenarios without calling LLM on 2nd call', async () => {
    const conversation = makeConversation({
      extractedProfile: cachedProfile,
      scenarios: cachedScenarios,
    } as Partial<AiConversation>);
    conversationRepo.findOne.mockResolvedValue(conversation);

    const result = await service.complete({ conversationId: 'conv-1' });

    expect(llmService.chat).not.toHaveBeenCalled();
    expect(messageRepo.find).not.toHaveBeenCalled();
    expect(result).toMatchObject(cachedProfile);
    expect(result.scenarios).toEqual(cachedScenarios);
  });

  it('writes cache when profile structured AND scenarios.length === 5', async () => {
    const conversation = makeConversation();
    conversationRepo.findOne.mockResolvedValue(conversation);
    messageRepo.find.mockResolvedValue([]);
    conversationRepo.update = jest.fn().mockResolvedValue({});

    llmService.chat
      .mockResolvedValueOnce(JSON.stringify(cachedProfile))
      .mockResolvedValueOnce(makeValidScenariosJson());

    await service.complete({ conversationId: 'conv-1' });

    expect(conversationRepo.update).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({
        extractedProfile: expect.objectContaining({ nativeLanguage: 'English' }),
        scenarios: expect.any(Array),
      }),
    );
  });

  it('does NOT write cache when profile parse fails (raw fallback)', async () => {
    const conversation = makeConversation();
    conversationRepo.findOne.mockResolvedValue(conversation);
    messageRepo.find.mockResolvedValue([]);
    conversationRepo.update = jest.fn();

    llmService.chat
      .mockResolvedValueOnce('not-json-at-all')  // parseExtraction returns {raw: ...}
      .mockResolvedValueOnce(makeValidScenariosJson());

    await service.complete({ conversationId: 'conv-1' });

    expect(conversationRepo.update).not.toHaveBeenCalled();
  });

  it('does NOT write cache when scenarios empty (LLM failure)', async () => {
    const conversation = makeConversation();
    conversationRepo.findOne.mockResolvedValue(conversation);
    messageRepo.find.mockResolvedValue([]);
    conversationRepo.update = jest.fn();

    llmService.chat
      .mockResolvedValueOnce(JSON.stringify(cachedProfile))
      .mockRejectedValueOnce(new Error('LLM timeout'));

    await service.complete({ conversationId: 'conv-1' });

    expect(conversationRepo.update).not.toHaveBeenCalled();
  });
});
```

### Step 2 — Controller spec

Add a test for the GET route in `onboarding.controller.spec.ts`:

```ts
describe('GET /onboarding/conversations/:conversationId/messages', () => {
  it('delegates to service.getMessages with path param', async () => {
    const expected = {
      conversationId: VALID_UUID,
      turnNumber: 1,
      maxTurns: onboardingConfig.maxTurns,
      isLastTurn: false,
      messages: [],
    };
    jest.spyOn(service, 'getMessages').mockResolvedValue(expected);

    const result = await controller.getMessages(VALID_UUID);

    expect(service.getMessages).toHaveBeenCalledWith(VALID_UUID);
    expect(result).toEqual(expected);
  });
});
```

### Step 3 — Run & iterate

```bash
npm test -- onboarding
```

All existing tests must still pass. Fix any regressions.

### Step 4 — E2E (only if existing tests don't cover)

If `test/onboarding.e2e-spec.ts` exists, extend; else create. Pattern:

```ts
it('POST /chat → GET /messages returns transcript', async () => {
  const chat = await request(app.getHttpServer())
    .post('/onboarding/chat')
    .send({ nativeLanguage: 'vi', targetLanguage: 'en' })
    .expect(200);

  const convId = chat.body.data.conversation_id;

  const messages = await request(app.getHttpServer())
    .get(`/onboarding/conversations/${convId}/messages`)
    .expect(200);

  expect(messages.body.data.conversation_id).toBe(convId);
  expect(messages.body.data.messages.length).toBeGreaterThan(0);
});
```

(E2E may require LLM env vars or mocking — skip if CI lacks fixtures.)

## Todo List

- [ ] Add `getMessages` describe block (4 tests)
- [ ] Add `complete (idempotency)` describe block (4 tests)
- [ ] Add controller GET test
- [ ] `npm test -- onboarding` all green
- [ ] Optional: E2E test for resume flow

## Success Criteria

- All new + existing `onboarding.service.spec.ts` and `onboarding.controller.spec.ts` tests pass.
- `llmService.chat` not-called assertion on cache-hit test holds.
- `conversationRepo.update` not-called assertion on cache-miss-with-failure tests hold.

## Risk Assessment

- **Risk:** `conversationRepo.update` not in existing mock factory. **Mitigation:** add `update: jest.fn()` to `mockConversationRepo`.
- **Risk:** `scenarios` UUIDs in test fixtures are not real UUIDs. **Mitigation:** fine for unit tests — controller serialization doesn't validate cached data shape.

## Security Considerations

N/A (test code).

## Next Steps

Phase 05 docs update.
