# Phase 02: Prompt File + ScenarioChatService

## Context Links
- Brainstorm: `plans/reports/brainstorm-260412-2214-scenario-chat-api.md`
- Reference prompts: `src/modules/ai/prompts/correction-check-prompt.json`, `tutor-system-prompt.md`
- Reference service: `src/modules/ai/services/learning-agent.service.ts`

## Overview
- Priority: P1
- Status: complete
- Effort: M (2h)

Create JSON prompt + new `ScenarioChatService` encapsulating roleplay logic.

## Key Insights

- **PromptLoaderService** already loads `.json` files as raw strings with `{{var}}` regex substitution. Works for our structured JSON prompt without loader changes.
- **LearningAgentService** has a clean reference pattern: load prompt → build `BaseMessage[]` → call `llmService.chat()` → persist messages. We mirror it, not extend it (separation: roleplay ≠ tutor).
- **No `ScenarioService.checkAccess()`** exists — extract access check from `lesson.service.ts` patterns. Query scenario + subscription + `UserScenarioAccess`.
- **User's target language + proficiency** comes from `LanguageService.getUserLanguages(userId)` (pick active). **Native language** from `User.nativeLanguageId` relation.
- **History**: reuse `AiConversationMessage` repo; last 20 messages ordered by `createdAt ASC`.

## Requirements

**Functional**
- `scenarioChat(userId, dto)` handles 3 cases: no conversationId + empty message (AI opening), no conversationId + message (user opener), existing conversationId (resume).
- Enforces `maxTurns` (12 default, stored in metadata).
- Marks `metadata.completed = true` on last AI reply.
- Rejects when user attempts to continue completed conversation — suggests starting new.
- Validates scenario access (premium, UserScenarioAccess, language match).

**Non-functional**
- Keep service under 200 lines. Split helpers to separate files if needed.
- All DB queries use parameterized ORM methods.

## Architecture

### Prompt: `src/modules/ai/prompts/scenario-chat-prompt.json`
```json
{
  "role": "Immersive language-learning roleplay partner",
  "instruction": "Play the character and setting implied by the scenario. Stay in character. Calibrate difficulty to the learner.",
  "scenario": {
    "title": "{{scenarioTitle}}",
    "description": "{{scenarioDescription}}",
    "category": "{{scenarioCategory}}"
  },
  "learner": {
    "target_language": "{{targetLanguage}}",
    "native_language": "{{nativeLanguage}}",
    "proficiency_level": "{{proficiencyLevel}}"
  },
  "turn_context": {
    "current_turn": "{{currentTurn}}",
    "max_turns": "{{maxTurns}}",
    "is_opening": "{{isOpening}}",
    "is_wrap_up": "{{isWrapUp}}"
  },
  "rules": [
    "Reply ONLY in {{targetLanguage}}; include a brief {{nativeLanguage}} gloss in parentheses only if proficiency_level is 'beginner'",
    "Stay in character at all times; do not break the fourth wall",
    "Keep reply under 3 sentences",
    "If is_opening is 'true': greet the user, introduce yourself as the character, and briefly set the scene",
    "If is_wrap_up is 'true': naturally bring the scenario to a close with a short farewell"
  ],
  "output_rules": { "format": "plain_text", "no_prefix": true, "language": "{{targetLanguage}}" }
}
```

### Service: `src/modules/scenario/services/scenario-chat.service.ts`

```ts
@Injectable()
export class ScenarioChatService {
  constructor(
    @InjectRepository(AiConversation) private readonly convoRepo: Repository<AiConversation>,
    @InjectRepository(AiConversationMessage) private readonly msgRepo: Repository<AiConversationMessage>,
    @InjectRepository(Scenario) private readonly scenarioRepo: Repository<Scenario>,
    private readonly llmService: UnifiedLLMService,
    private readonly promptLoader: PromptLoaderService,
    private readonly languageService: LanguageService,
    private readonly scenarioAccessService: ScenarioAccessService, // new helper (see below)
  ) {}

  async chat(userId: string, dto: ScenarioChatRequestDto): Promise<ScenarioChatResponseDto> {
    // 1. Load scenario + verify access
    const scenario = await this.scenarioAccessService.findAccessibleScenario(userId, dto.scenarioId);

    // 2. Resolve conversation (resume or create)
    const conversation = dto.conversationId
      ? await this.resolveExisting(userId, dto.conversationId, dto.scenarioId)
      : await this.findOrCreate(userId, scenario);

    // 3. Check not completed
    if (conversation.metadata?.completed) {
      throw new BadRequestException({ code: 'CONVERSATION_COMPLETED', message: 'Start a new conversation.' });
    }

    // 4. Load user language context
    const langCtx = await this.loadLanguageContext(userId);

    // 5. Load history
    const history = await this.loadHistory(conversation.id);

    // 6. Compute turn metadata
    const currentTurn = Math.floor(history.length / 2) + 1;
    const maxTurns = conversation.metadata?.maxTurns ?? 12;
    const isOpening = history.length === 0;
    const isWrapUp = currentTurn >= maxTurns;

    // 7. Build prompt
    const systemPrompt = this.promptLoader.loadPrompt('scenario-chat-prompt.json', {
      scenarioTitle: scenario.title,
      scenarioDescription: scenario.description ?? '',
      scenarioCategory: scenario.category?.name ?? 'general',
      targetLanguage: langCtx.targetLanguage,
      nativeLanguage: langCtx.nativeLanguage,
      proficiencyLevel: langCtx.proficiencyLevel,
      currentTurn: String(currentTurn),
      maxTurns: String(maxTurns),
      isOpening: String(isOpening),
      isWrapUp: String(isWrapUp),
    });

    // 8. Build messages for LLM
    const messages: BaseMessage[] = [new SystemMessage(systemPrompt), ...history];
    if (dto.message) messages.push(new HumanMessage(dto.message));

    // 9. Call LLM
    const reply = await this.llmService.chat(messages, {
      metadata: { feature: 'scenario_chat', conversationId: conversation.id, turn: currentTurn, scenarioId: scenario.id },
    });

    // 10. Persist messages (user message only if provided)
    if (dto.message) {
      await this.msgRepo.save(this.msgRepo.create({ conversationId: conversation.id, role: 'user', content: dto.message }));
    }
    await this.msgRepo.save(this.msgRepo.create({ conversationId: conversation.id, role: 'assistant', content: reply }));

    // 11. Update conversation state
    const completed = currentTurn >= maxTurns;
    conversation.messageCount += dto.message ? 2 : 1;
    conversation.metadata = { ...conversation.metadata, maxTurns, completed };
    await this.convoRepo.save(conversation);

    return { reply, conversationId: conversation.id, turn: currentTurn, maxTurns, completed };
  }

  private async findOrCreate(userId: string, scenario: Scenario): Promise<AiConversation> {
    const existing = await this.convoRepo
      .createQueryBuilder('c')
      .where('c.userId = :userId AND c.scenarioId = :scenarioId', { userId, scenarioId: scenario.id })
      .andWhere(`(c.metadata->>'completed')::boolean IS NOT TRUE`)
      .orderBy('c.createdAt', 'DESC')
      .getOne();
    if (existing) return existing;
    return this.convoRepo.save(this.convoRepo.create({
      userId,
      scenarioId: scenario.id,
      languageId: scenario.languageId,
      type: AiConversationType.AUTHENTICATED,
      title: scenario.title,
      topic: 'scenario_roleplay',
      metadata: { maxTurns: 12, completed: false },
    }));
  }

  private async resolveExisting(userId: string, conversationId: string, scenarioId: string): Promise<AiConversation> {
    const c = await this.convoRepo.findOne({ where: { id: conversationId } });
    if (!c) throw new NotFoundException('Conversation not found');
    if (c.userId !== userId) throw new ForbiddenException();
    if (c.scenarioId !== scenarioId) throw new BadRequestException('scenarioId mismatch');
    return c;
  }

  private async loadHistory(conversationId: string): Promise<BaseMessage[]> {
    const rows = await this.msgRepo.find({ where: { conversationId }, order: { createdAt: 'ASC' }, take: 20 });
    return rows.map(r => r.role === 'user' ? new HumanMessage(r.content) : new AIMessage(r.content));
  }

  private async loadLanguageContext(userId: string): Promise<{ targetLanguage: string; nativeLanguage: string; proficiencyLevel: string }> {
    const langs = await this.languageService.getUserLanguages(userId);
    const active = langs.find(l => l.isActive) ?? langs[0];
    if (!active) throw new BadRequestException('User has no active learning language');
    const native = await this.languageService.getNativeLanguage(userId); // add helper if missing
    return {
      targetLanguage: active.language.name,
      nativeLanguage: native?.name ?? 'English',
      proficiencyLevel: active.proficiencyLevel,
    };
  }
}
```

### Helper: `src/modules/scenario/services/scenario-access.service.ts`
Extract access check from `lesson.service.ts`:
- Query scenario by id
- Check `isActive`, `isPremium` vs subscription, `UserScenarioAccess` grant
- Throw `ForbiddenException` or `NotFoundException` as appropriate

## Related Code Files

**Create**
- `src/modules/ai/prompts/scenario-chat-prompt.json`
- `src/modules/scenario/services/scenario-chat.service.ts`
- `src/modules/scenario/services/scenario-access.service.ts`

**Modify**
- `src/modules/language/language.service.ts` — add `getNativeLanguage(userId)` helper if missing (reads `User.nativeLanguageId`)

**Read for reference**
- `src/modules/ai/services/learning-agent.service.ts`
- `src/modules/lesson/lesson.service.ts` (access pattern)
- `src/modules/ai/services/prompt-loader.service.ts`

## Implementation Steps

1. Create `scenario-chat-prompt.json` exactly as shown above.
2. Create `scenario-access.service.ts` — extract visibility + subscription + access check into clean method `findAccessibleScenario(userId, scenarioId): Promise<Scenario>`.
3. Add `getNativeLanguage(userId)` to `LanguageService` if missing.
4. Create `scenario-chat.service.ts` per architecture above.
5. `npm run build` — fix any TS errors.
6. Verify prompt loads: quick unit test loading the file + substituting vars.

## Todo List

- [x] Create `scenario-chat-prompt.json`
- [x] Create `ScenarioAccessService` with `findAccessibleScenario()`
- [x] Add `getNativeLanguage()` to `LanguageService` (if missing)
- [x] Create `ScenarioChatService` with `chat()` method + helpers
- [x] `npm run build` clean
- [x] Manual smoke test: load prompt template, verify variable substitution

## Success Criteria

- Service compiles without errors
- `findAccessibleScenario()` throws `ForbiddenException` for premium scenario + free user
- `findOrCreate()` returns existing conversation when same `(userId, scenarioId)` and not completed
- Prompt loader returns string with all `{{vars}}` replaced

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Prompt JSON becomes invalid after var substitution (e.g., user-provided scenario description has unescaped quotes) | Scenario data is admin-controlled, not user input. Still: add test case with quote in description. |
| `conversation.metadata` is null when accessed | Default to `{}` using `conversation.metadata ?? {}` everywhere |
| History ordering bug causes AI confusion | Use `ORDER BY createdAt ASC`, test with 5+ message sample |
| Max-turn off-by-one | Explicit unit test: 12-turn conversation sets `completed=true` exactly on turn 12 |

## Security Considerations
- Ownership: `resolveExisting` checks `c.userId !== userId` → ForbiddenException
- Scenario-conversation mismatch: `c.scenarioId !== dto.scenarioId` → BadRequest (prevents cross-scenario hijack)
- Premium gating: `ScenarioAccessService` enforces subscription + access grant
- No user input reaches DB without parameterization (TypeORM)

## Next Steps
- Phase 03: Wire service into controller + module
