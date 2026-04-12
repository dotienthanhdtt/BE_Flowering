## Phase 1: Fix IDOR — Conversation Ownership Check

### Context
- Security review: [Vuln 1 — IDOR in chat endpoint](../../plans/reports/)
- Severity: **HIGH** | Confidence: 9/10

### Overview
- **Priority:** Critical
- **Status:** Pending
- `getConversationHistory()` and `saveMessage()` in `learning-agent.service.ts` accept `conversationId` without verifying it belongs to the requesting `userId`
- Authenticated user can read/write another user's conversation by supplying their UUID

### Key Insights
- `getConversationHistory()` (line 145): queries `{ where: { conversationId } }` — no `userId` constraint
- `saveMessage()` (line 157): writes to any `conversationId` with no ownership check
- `conversationRepo.increment()` (line 66, 110): increments messageCount on any conversation
- `userId` is already passed from controller but only used for Langfuse metadata, not DB queries
- `AiConversation` entity has `userId` column — ownership data exists, just not enforced

### Requirements
- All conversation read/write operations MUST verify `userId` ownership
- Return `ForbiddenException` if conversation doesn't belong to requesting user
- Must not break anonymous onboarding conversations (those have `userId: null`)

### Related Code Files
**Modify:**
- `src/modules/ai/services/learning-agent.service.ts` — add ownership validation

### Implementation Steps

1. **Add ownership validation method** to `LearningAgentService`:
   ```typescript
   private async validateConversationOwnership(
     conversationId: string,
     userId: string,
   ): Promise<void> {
     const conversation = await this.conversationRepo.findOne({
       where: { id: conversationId },
     });
     if (!conversation) {
       throw new NotFoundException('Conversation not found');
     }
     if (conversation.userId && conversation.userId !== userId) {
       throw new ForbiddenException('Access denied');
     }
   }
   ```

2. **Call validation before reading/writing** in `chat()` (before line 45):
   ```typescript
   if (context.conversationId) {
     await this.validateConversationOwnership(context.conversationId, userId);
   }
   ```

3. **Same in `streamChat()`** (before line 87):
   ```typescript
   if (context.conversationId) {
     await this.validateConversationOwnership(context.conversationId, userId);
   }
   ```

4. **Run `npm run build`** to verify compilation.

### Todo
- [ ] Add `validateConversationOwnership` method
- [ ] Call ownership check in `chat()` before history fetch
- [ ] Call ownership check in `streamChat()` before history fetch
- [ ] Verify build passes

### Success Criteria
- Authenticated user cannot read conversation history of another user
- Authenticated user cannot write messages to another user's conversation
- Anonymous conversations (`userId: null`) still work for onboarding
- No build errors

### Risk Assessment
- **Low risk:** Single-file change, clear ownership pattern
- **Edge case:** Anonymous conversations have `userId: null` — the check must allow access when conversation has no owner (handled by `conversation.userId && ...` guard)

### Security Considerations
- Uses DB-level ownership check (not client-side)
- Fails closed: unknown conversation → NotFoundException, wrong owner → ForbiddenException
