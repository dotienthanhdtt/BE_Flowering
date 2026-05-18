# Persist correctedText on chat/correct

## Goal
Store the AI-generated `correctedText` for a user chat message on `ai_conversation_messages.corrected_content`, so corrections survive past the HTTP response and can be displayed in review/history UIs.

## Decisions (confirmed)
- **Link**: client passes optional `messageId` UUID; endpoint writes to that row.
- **Anon writes**: allowed when `messageId` provided (no ownership check). Existing endpoint is `@OptionalAuth()` + `@RequirePremium(false)`.
- **Storage**: new nullable column `corrected_content text` on `ai_conversation_messages`, mirroring `translated_content` pattern.

## Scope
Single phase — small feature, no cross-module impact.

- [phase-01-implement.md](./phase-01-implement.md) — migration, entity, DTO, service, controller wiring.

## Non-Goals
- Correction history (multiple attempts per message) — single-shot overwrite is fine for now (YAGNI).
- Backfill of historical messages.
- New read endpoint — `corrected_content` is already returned by any flow that loads the message row; clients can re-fetch via existing conversation message endpoints if needed.
- Auth/ownership enforcement on writes — explicitly out of scope per user decision.

## Key Files
- `src/database/migrations/{ts}-add-corrected-content-to-ai-conversation-messages.ts` (new)
- `src/database/entities/ai-conversation-message.entity.ts`
- `src/modules/ai/dto/correction-check.dto.ts`
- `src/modules/ai/services/learning-agent.service.ts`
- `src/modules/ai/ai.controller.ts`
- `src/modules/ai/ai.module.ts` (inject repository)

## Risks
- **Silent no-op**: if client omits `messageId`, behavior is identical to today (no write). Doc this in DTO.
- **Tampering**: anyone with a valid messageId UUID can overwrite that message's `corrected_content`. Accepted trade-off; UUIDs are not enumerable.
- **Race**: two concurrent correct calls on the same messageId → last write wins. Acceptable; correction is deterministic-ish.
- **Compile gate**: run `npm run build` after edits (per `CLAUDE.md` Railway deployment rules).
