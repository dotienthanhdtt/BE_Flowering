# Phase 01 — Implement corrected_content persistence

## Context
- Endpoint: `POST /ai/chat/correct` (`src/modules/ai/ai.controller.ts:52`)
- Service: `LearningAgentService.checkCorrection` (`src/modules/ai/services/learning-agent.service.ts:22`)
- Entity: `AiConversationMessage` (`src/database/entities/ai-conversation-message.entity.ts`)
- Latest migration ts: `1782500000000` → new one uses `1782600000000`

## Overview
- **Priority**: Medium
- **Status**: Planned
- Add `corrected_content` text column on `ai_conversation_messages`, accept optional `messageId` in correction request, write LLM result back to that row when provided.

## Key Insights
- Existing `translated_content`/`translated_lang` columns establish the precedent for storing AI-derived per-message text — same nullable-text pattern reused.
- Endpoint is intentionally `@OptionalAuth()`; user explicitly chose no ownership check, so service writes blindly when `messageId` is present.
- `correctedText` is `null` when no errors found. Persist `null` too — overwrites stale corrections from earlier attempts.

## Requirements

**Functional**
- New request field `messageId?: string` (UUID).
- When `messageId` provided AND row exists: set `corrected_content = correctedText` (including null) and save.
- When `messageId` absent OR row not found: behave exactly as today (no write, no error).
- Response shape unchanged.

**Non-Functional**
- No regression for existing callers (field is optional).
- Build passes (`npm run build`).
- Migration reversible (`up` adds column, `down` drops).

## Architecture

```
Controller.checkCorrection
   └─ LearningAgentService.checkCorrection(prev, user, lang, convId, messageId?)
        ├─ UnifiedLLMService.chat(...)        → correctedText
        └─ if messageId:
             messageRepo.update(messageId, { correctedContent: correctedText })
```

Repository injected into `LearningAgentService` via `@InjectRepository(AiConversationMessage)`. Use `update()` (no read-modify-write) for atomicity and to silently no-op on missing row.

## Related Code Files

**Create**
- `src/database/migrations/1782600000000-add-corrected-content-to-ai-conversation-messages.ts`

**Modify**
- `src/database/entities/ai-conversation-message.entity.ts` — add `correctedContent` field.
- `src/modules/ai/dto/correction-check.dto.ts` — add optional `messageId` to request DTO.
- `src/modules/ai/services/learning-agent.service.ts` — inject repo, accept `messageId`, conditional write.
- `src/modules/ai/ai.controller.ts` — pass `dto.messageId` through.
- `src/modules/ai/ai.module.ts` — verify `AiConversationMessage` in `TypeOrmModule.forFeature([...])`; add if missing.
- `src/database/database.module.ts` — already registers entity (verify; per CLAUDE.md double-registration rule).

## Implementation Steps

1. **Migration** — `1782600000000-add-corrected-content-to-ai-conversation-messages.ts`
   - `up`: `ALTER TABLE ai_conversation_messages ADD COLUMN corrected_content text NULL;`
   - `down`: `ALTER TABLE ai_conversation_messages DROP COLUMN corrected_content;`

2. **Entity** — add field after `translatedLang`:
   ```ts
   @Column({ type: 'text', name: 'corrected_content', nullable: true })
   correctedContent?: string | null;
   ```

3. **DTO** — extend `CorrectionCheckRequestDto`:
   ```ts
   @ApiPropertyOptional({ description: 'Message ID to persist correction to' })
   @IsOptional()
   @IsUUID()
   messageId?: string;
   ```

4. **Service** — `LearningAgentService`:
   - Inject `@InjectRepository(AiConversationMessage) private messageRepo: Repository<AiConversationMessage>`.
   - Add `messageId?: string` param.
   - After computing `correctedText`, if `messageId` set:
     ```ts
     await this.messageRepo.update({ id: messageId }, { correctedContent: correctedText });
     ```
   - Wrap write in try/catch; log warning on failure but still return result (correction is the primary product, persistence is best-effort).

5. **Controller** — pass `dto.messageId` to service call.

6. **Module wiring** — confirm `AiModule`'s `TypeOrmModule.forFeature([...])` includes `AiConversationMessage`; same for `DatabaseModule` global entities array.

7. **Build gate** — `npm run build` (catches TS errors before commit; per Railway deployment rules in CLAUDE.md).

8. **Migration run** — `npm run migration:run` against dev DB to apply schema.

## Todo List
- [ ] Create migration file `1782600000000-add-corrected-content-to-ai-conversation-messages.ts`
- [ ] Add `correctedContent` column to `AiConversationMessage` entity
- [ ] Add optional `messageId` to `CorrectionCheckRequestDto`
- [ ] Inject `AiConversationMessage` repo into `LearningAgentService`
- [ ] Implement conditional write in `checkCorrection`
- [ ] Wire `messageId` through controller
- [ ] Verify entity registration in `AiModule` + `DatabaseModule`
- [ ] `npm run build` passes
- [ ] `npm run migration:run` succeeds on dev
- [ ] Manual smoke: POST `/ai/chat/correct` with valid messageId → row updated; without → unchanged

## Success Criteria
- `corrected_content` column exists on `ai_conversation_messages`.
- Calling endpoint with `messageId` writes correction (text or NULL) to the row.
- Calling endpoint without `messageId` returns same response as before, zero DB writes.
- Build green, migration reversible.

## Risk Assessment
| Risk | Mitigation |
|------|------------|
| Repo not injected → runtime `Nest can't resolve dependencies` | Verify `forFeature` registration; build won't catch this |
| Entity missing from `DatabaseModule` global array | Per CLAUDE.md: register in both places to avoid `EntityMetadataNotFoundError` |
| Anon caller passes random UUID → no-op silently | Acceptable per user decision; `update()` returns affected=0, swallow |
| Persistence failure breaks correction response | try/catch around write; log + continue |

## Security Considerations
- No ownership check by design (user-confirmed). Threat: any client with a valid message UUID can overwrite that message's `corrected_content`. UUIDs are non-enumerable; impact bounded to one column on one row; no PII leak (write-only).
- Input already validated by `@IsUUID()` — prevents SQL injection vectors via DTO.

## Next Steps
- Optional follow-up: add ownership enforcement once auth model for correction is finalized.
- Optional follow-up: expose `correctedContent` in conversation message read DTOs if frontend needs it on history fetch.

## Open Questions
- None — all decisions confirmed by user.
