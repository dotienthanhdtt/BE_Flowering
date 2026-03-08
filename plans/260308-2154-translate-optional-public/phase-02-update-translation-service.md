# Phase 2: Update Translation Service

## Context
- [translation.service.ts](../../src/modules/ai/services/translation.service.ts)
- [onboarding.service.ts](../../src/modules/onboarding/onboarding.service.ts)
- [ai-conversation.entity.ts](../../src/database/entities/ai-conversation.entity.ts)
- [ai.module.ts](../../src/modules/ai/ai.module.ts)

## Overview
- **Priority:** P1
- **Status:** pending
- Add anonymous translation paths to `TranslationService`

## Key Insights
- Onboarding stores sessions in DB: `AiConversation` with `sessionToken` + `type=ANONYMOUS`
- Anonymous word translate: LLM call only, no vocabulary upsert, no `vocabularyId` in result
- Anonymous sentence translate: verify ownership via `sessionToken` -> `conversation.id` -> `message.conversationId`
- `TranslationService` needs `AiConversation` repository (currently only has `AiConversationMessage` + `Vocabulary`)
- `WordTranslationResult.vocabularyId` becomes optional for anonymous case

## Related Code Files

### Modify
- `src/modules/ai/services/translation.service.ts` -- add anonymous paths
- `src/modules/ai/ai.module.ts` -- add `AiConversation` to `TypeOrmModule.forFeature` if not already present

### No new files needed

## Implementation Steps

### Step 1: Register AiConversation in AiModule
Check if `AiConversation` is already in `AiModule`'s `TypeOrmModule.forFeature()`. If not, add it.

### Step 2: Inject AiConversation repository in TranslationService
```typescript
@InjectRepository(AiConversation)
private conversationRepo: Repository<AiConversation>,
```

### Step 3: Update WordTranslationResult interface
Make `vocabularyId` optional:
```typescript
export interface WordTranslationResult {
  original: string;
  translation: string;
  partOfSpeech?: string;
  pronunciation?: string;
  definition?: string;
  examples?: string[];
  vocabularyId?: string;  // undefined for anonymous users
}
```

### Step 4: Update translateWord signature and logic
New signature:
```typescript
async translateWord(
  text: string,
  sourceLang: string,
  targetLang: string,
  userId: string | null,
  sessionToken?: string,
): Promise<WordTranslationResult>
```

Logic:
1. Validate: if no `userId` and no `sessionToken`, throw `BadRequestException`
2. Call LLM (same for both paths)
3. If `userId`: upsert to vocabulary (existing logic), return with `vocabularyId`
4. If anonymous: return translation result without `vocabularyId`, no DB write

### Step 5: Update translateSentence signature and logic
New signature:
```typescript
async translateSentence(
  messageId: string,
  sourceLang: string,
  targetLang: string,
  userId: string | null,
  sessionToken?: string,
): Promise<SentenceTranslationResult>
```

Logic:
1. Fetch message with `conversation` relation (existing)
2. Verify ownership:
   - If `userId`: check `message.conversation.userId === userId` (existing)
   - If `sessionToken`: check `message.conversation.sessionToken === sessionToken` AND `message.conversation.type === ANONYMOUS`
   - If neither: throw `BadRequestException`
3. Rest of logic (cache check, LLM call, save cache) stays the same

### Step 6: Extract ownership verification to private method
Keep DRY by extracting:
```typescript
private async verifyMessageOwnership(
  message: AiConversationMessage & { conversation: AiConversation },
  userId: string | null,
  sessionToken?: string,
): void {
  if (userId && message.conversation.userId === userId) return;
  if (sessionToken
    && message.conversation.sessionToken === sessionToken
    && message.conversation.type === AiConversationType.ANONYMOUS) return;
  throw new ForbiddenException('You do not own this conversation');
}
```

## Todo List
- [ ] Add `AiConversation` to `AiModule` `TypeOrmModule.forFeature()` if missing
- [ ] Inject `AiConversation` repository in `TranslationService`
- [ ] Make `vocabularyId` optional in `WordTranslationResult`
- [ ] Update `translateWord` -- skip vocabulary upsert for anonymous
- [ ] Update `translateSentence` -- verify via sessionToken for anonymous
- [ ] Extract ownership verification to private method
- [ ] Ensure metadata in LLM calls uses `sessionToken` when no `userId`
- [ ] Verify file stays under 200 lines

## Success Criteria
- Authenticated word translate: LLM + vocabulary upsert (unchanged)
- Anonymous word translate: LLM only, no vocabulary save, no `vocabularyId`
- Authenticated sentence translate: ownership via `userId` (unchanged)
- Anonymous sentence translate: ownership via `sessionToken`
- Translation caching on messages works for both paths
- No breaking changes to existing response format (vocabularyId just becomes optional)

## Security Considerations
- Anonymous sentence translate MUST verify `sessionToken` matches the message's conversation
- Must also check `conversation.type === ANONYMOUS` to prevent sessionToken spoofing on authenticated conversations
- Rate limiting via ThrottlerGuard still applies (controller-level)
- No vocabulary data leaks for anonymous users (nothing saved)

## Risk
- `AiConversation` entity might not be in `database.module.ts` global entities -- verify and add if needed (per CLAUDE.md Railway rules)
- File size: current `translation.service.ts` is 187 lines; additions ~30 lines. May need to extract helper methods to stay under 200 lines
