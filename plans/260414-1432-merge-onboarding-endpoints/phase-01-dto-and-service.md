# Phase 01 — DTO Refactor + Service `handleChat`

## Context Links

- Plan overview: `plan.md`
- Scout touch points: `src/modules/onboarding/dto/onboarding-chat.dto.ts`, `src/modules/onboarding/dto/start-onboarding.dto.ts`, `src/modules/onboarding/onboarding.service.ts`
- Existing DTO barrel: `src/modules/onboarding/dto/index.ts`

## Overview

- **Priority:** P1 (blocker for controller wiring)
- **Status:** completed
- **Brief:** Extend `OnboardingChatDto` with optional `conversationId`, `nativeLanguage`, `targetLanguage` using `@ValidateIf`. Delete `StartOnboardingDto`. Add `handleChat()` composer in service. Make `startSession()` + `chat()` private.

## Key Insights

- `conversationId` becomes optional (was required). When absent, language fields required.
- Existing `chat()` already handles `msgCount === 0 → currentTurn = 1` with no user message — first-turn greeting reuse works.
- `@Transform` on `message` (empty-string → undefined) stays.
- `startSession()` already returns `{ conversationId }`. `chat()` returns `{ reply, messageId, turnNumber, isLastTurn }`. Compose → uniform shape.

## Requirements

**Functional**
- DTO accepts either `{nativeLanguage, targetLanguage}` (creation) or `{conversationId, message?}` (chat).
- `handleChat(dto)` returns `{ conversationId, reply, messageId, turnNumber, isLastTurn }`.
- Invalid combos rejected at DTO validation layer (400).

**Non-functional**
- File under 200 lines.
- No duplicated validation logic between DTO and service.

## Architecture

Data flow:
```
Controller → handleChat(dto)
             ├─ if !dto.conversationId → startSession({native, target}) → conversationId
             └─ chat({conversationId, message})
             → { conversationId, reply, messageId, turnNumber, isLastTurn }
```

## Related Code Files

**Modify**
- `src/modules/onboarding/dto/onboarding-chat.dto.ts` — add 3 optional fields with `@ValidateIf`
- `src/modules/onboarding/dto/index.ts` — remove `StartOnboardingDto` export
- `src/modules/onboarding/onboarding.service.ts` — add `handleChat`, downgrade `startSession`/`chat` to `private`

**Delete**
- `src/modules/onboarding/dto/start-onboarding.dto.ts`

**Read for context**
- `src/modules/onboarding/onboarding.config.ts` (TTL, maxTurns)

## Implementation Steps

1. Grep `StartOnboardingDto` usages across repo (`rg "StartOnboardingDto"`). Confirm only controller + service + DTO barrel.
2. Edit `onboarding-chat.dto.ts`:
   - Change `conversationId` → `@IsOptional() @IsUUID()`.
   - Add `nativeLanguage`, `targetLanguage` with `@ValidateIf(o => !o.conversationId) @IsString() @Length(2, 5)`.
   - Keep `message` transform + validators unchanged.
3. Delete `start-onboarding.dto.ts`.
4. Edit `dto/index.ts`: drop `StartOnboardingDto` export.
5. Edit `onboarding.service.ts`:
   - Drop `StartOnboardingDto` import.
   - Change `startSession` signature: `private async startSession(args: { nativeLanguage: string; targetLanguage: string })`.
   - Change `chat` to `private async chat(...)`.
   - Add `async handleChat(dto: OnboardingChatDto)`:
     ```ts
     const conversationId = dto.conversationId
       ?? (await this.startSession({
           nativeLanguage: dto.nativeLanguage!,
           targetLanguage: dto.targetLanguage!,
         })).conversationId;
     const result = await this.chat({ conversationId, message: dto.message });
     return { conversationId, ...result };
     ```
6. Run `npm run build` — expect zero TS errors.

## Todo List

- [ ] Grep `StartOnboardingDto` usages
- [ ] Update `onboarding-chat.dto.ts`
- [ ] Delete `start-onboarding.dto.ts`
- [ ] Update `dto/index.ts` barrel
- [ ] Add `handleChat` in service, mark helpers private
- [ ] `npm run build` passes

## Success Criteria

- `npm run build` clean.
- `OnboardingChatDto` validates both shapes correctly (verified in phase 04 tests).
- `handleChat` is the only public entry point on service (besides existing `complete`).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| External import of `StartOnboardingDto` | Low | Medium | Grep before delete |
| `@ValidateIf` misfire (both keys present) | Low | Low | Test in phase 04 with unit spec |
| `startSession` called elsewhere | Low | High | Grep; if found, update callers or keep public |

## Security Considerations

- DTO validation is first defense vs malformed payloads.
- `@Length(2, 5)` on language codes prevents SSRF-style abuse downstream.
- No auth change — route stays `@Public()` (handled in phase 03).

## Next Steps

Phase 02 (throttler guard) runs in parallel. Phase 03 (controller) depends on this.
