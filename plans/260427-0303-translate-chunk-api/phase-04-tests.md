# Phase 4 — Tests + Manual Verification

## Context Links
- Existing spec: `src/modules/ai/services/translation.service.spec.ts`
- Brainstorm: `../reports/brainstorm-260427-0258-translate-chunk-api.md`

## Overview
- **Priority:** P2
- **Status:** complete
- **Effort:** ~1h
Add unit tests for `translateChunk()`. Run full lint/build/test. Manual curl smoke against dev server with real JWT.

## Key Insights
- Mock `UnifiedLLMService.chat` to return canned JSON — DO NOT hit real Gemini in unit tests.
- Mock `messageRepo.findOne` to control ownership/404 paths.
- Vocab repo: use in-memory or mock `createQueryBuilder` chain — mirror existing `translateWord` test pattern.

## Requirements
- Tests cover: success path (authed), 404 missing message, 403 non-owner, 400 bad tap range, malformed JSON fallback, type whitelist (garbage type → `'word'`), out-of-bounds clamp.
- All tests pass green.
- `npm run build` clean.
- `npm run lint` no new errors.

## Architecture
Test uses NestJS `Test.createTestingModule` with mocked repositories and services (same pattern as existing `translation.service.spec.ts`).

## Related Code Files
**Modify:**
- `src/modules/ai/services/translation.service.spec.ts`

## Implementation Steps

### 1. Test cases to add

```ts
describe('translateChunk', () => {
  const userId = 'user-uuid';
  const messageId = 'msg-uuid';
  const sentence = '我在一家科技公司工作';

  beforeEach(() => {
    messageRepo.findOne.mockResolvedValue({
      id: messageId,
      content: sentence,
      conversationId: 'conv-uuid',
      conversation: { id: 'conv-uuid', userId, type: 'authenticated' },
    });
    // mock vocab upsert returning generated id
    vocabularyRepo.createQueryBuilder.mockReturnValue(mockUpsertChain('vocab-uuid'));
  });

  it('returns chunk with vocabularyId on success', async () => {
    llmService.chat.mockResolvedValue(JSON.stringify({
      text: '科技公司', type: 'compound_noun',
      from: 4, to: 8,
      translation: 'công ty công nghệ',
      pronunciation: 'kējì gōngsī',
    }));
    const r = await service.translateChunk(messageId, 'zh', 'vi', 4, 5, userId);
    expect(r.text).toBe('科技公司');
    expect(r.type).toBe('compound_noun');
    expect(r.vocabularyId).toBe('vocab-uuid');
  });

  it('throws 404 when message not found', async () => {
    messageRepo.findOne.mockResolvedValue(null);
    await expect(service.translateChunk(messageId, 'zh', 'vi', 0, 1, userId))
      .rejects.toThrow(NotFoundException);
  });

  it('throws 403 when caller not owner', async () => {
    messageRepo.findOne.mockResolvedValue({
      id: messageId, content: sentence, conversationId: 'c',
      conversation: { id: 'c', userId: 'other-user', type: 'authenticated' },
    });
    await expect(service.translateChunk(messageId, 'zh', 'vi', 0, 1, userId))
      .rejects.toThrow(ForbiddenException);
  });

  it('throws 400 on invalid tap range', async () => {
    await expect(service.translateChunk(messageId, 'zh', 'vi', 5, 5, userId))
      .rejects.toThrow(BadRequestException);
    await expect(service.translateChunk(messageId, 'zh', 'vi', -1, 2, userId))
      .rejects.toThrow(BadRequestException);
  });

  it('throws 400 when tapTo exceeds sentence length', async () => {
    await expect(service.translateChunk(messageId, 'zh', 'vi', 0, 999, userId))
      .rejects.toThrow(BadRequestException);
  });

  it('falls back to word type when LLM returns invalid type', async () => {
    llmService.chat.mockResolvedValue(JSON.stringify({
      text: '科技', type: 'NONSENSE', from: 4, to: 6,
      translation: 'tech', pronunciation: 'kējì',
    }));
    const r = await service.translateChunk(messageId, 'zh', 'vi', 4, 5, userId);
    expect(r.type).toBe('word');
  });

  it('clamps out-of-bounds from/to', async () => {
    llmService.chat.mockResolvedValue(JSON.stringify({
      text: '科技', type: 'word', from: -5, to: 9999,
      translation: 'tech', pronunciation: 'kējì',
    }));
    const r = await service.translateChunk(messageId, 'zh', 'vi', 4, 5, userId);
    expect(r.from).toBe(4);
    expect(r.to).toBe(5);
  });

  it('handles code-fenced JSON response', async () => {
    llmService.chat.mockResolvedValue('```json\n{"text":"科技","type":"word","from":4,"to":6,"translation":"tech","pronunciation":"kējì"}\n```');
    const r = await service.translateChunk(messageId, 'zh', 'vi', 4, 5, userId);
    expect(r.text).toBe('科技');
  });
});
```

Helper `mockUpsertChain(id)` returns the chained mock for `.insert().into().values().orUpdate().returning().execute()`.

### 2. Run suite
```bash
cd be_flowering
npm run lint
npm test -- translation.service.spec
npm run build
```

### 3. Manual curl smoke
```bash
# 1. Get JWT from dev login
JWT="..."
# 2. Find a real message id from your conv
MSG_ID="..."

curl -X POST http://localhost:3000/ai/translate/word \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "messageId":"'$MSG_ID'",
    "sourceLang":"en",
    "targetLang":"vi",
    "tapFrom":0,
    "tapTo":4
  }'
```
Verify:
- 200 with `{code:1, data:{text, type, from, to, translation, pronunciation, vocabularyId}}`
- Row appears in `vocabulary` table with `type` and `pronunciation` populated
- Idiom case: send a message with "kick the bucket", tap inside "bucket", verify response returns full idiom.

### 4. Regression check
```bash
curl -X POST http://localhost:3000/ai/translate \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"type":"word","text":"hello","sourceLang":"en","targetLang":"vi"}'
```
Must still work identically to before.

## Todo List
- [x] Add `translateChunk` describe block to spec
- [x] Implement 8 test cases listed above
- [x] `npm run lint` green
- [x] `npm test` green
- [x] `npm run build` green
- [x] Manual curl smoke (success + idiom + regression)
- [x] Verify DB row written with correct `type` + `pronunciation`

## Success Criteria
- All new tests pass.
- No regressions in existing translation tests.
- Build/lint clean.
- Manual smoke confirms end-to-end including DB write.
- Idiom resolution works in real LLM call.

## Risk Assessment
- **Risk:** Real Gemini returns slightly different field shape than prompt instructs. **Mitigation:** parser is defensive; iterate prompt if smoke fails.
- **Risk:** Mock chain for `createQueryBuilder` brittle. **Mitigation:** copy structure from existing `translateWord` test.

## Security Considerations
- Tests verify ownership rejection paths (403).
- Tests verify type whitelist (no LLM-injected garbage stored).

## Next Steps
- Update `docs/api-documentation.md` with new endpoint (post-merge).
- Consider adding response cache keyed on `(messageId, tapFrom, tapTo)` if usage data shows hot tap-spots (deferred — YAGNI).
