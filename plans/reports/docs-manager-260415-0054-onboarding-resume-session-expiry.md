# Documentation Update Report
**Date:** 2026-04-15  
**Task:** Update project documentation to reflect recent code changes (resume support + session expiry removal)

## Changes Reflected

### Recent Commits
- `ed6508a` feat(onboarding): add resume support with cached profile extraction
- `6a13ebb` refactor(onboarding): remove session expiry logic

### Code Changes Documented

**New Endpoints:**
- `GET /onboarding/conversations/:conversationId/messages` — Public, 30 req/hr per IP. Returns conversationId, turnNumber, maxTurns, isLastTurn, messages[] (id, role, content, createdAt).

**Idempotent Endpoint:**
- `POST /onboarding/complete` — First call caches extracted profile + 5 scenarios with stable UUIDs. Subsequent calls return same data without LLM invocation.

**Database Schema:**
- `ai_conversations.extracted_profile` — JSONB, nullable — cached learner profile
- `ai_conversations.scenarios` — JSONB, nullable — cached 5-scenario array with stable UUIDs
- Cache writes only on success: profile must be structured AND scenarios.length === 5

**Session Expiry Removed:**
- 7-day session TTL (`expiresAt` on ai_conversations) logic removed. `expiresAt` column deprecated but retained for backward compatibility.

**Rate Limiting (OnboardingThrottlerGuard):**
- 5 req/hr per IP — session creation (no conversationId)
- 30 req/hr per IP — session continuation or GET /messages (has conversationId)
- TTL window: 1 hour

## Files Updated

### Documentation Files Modified
1. **docs/codebase-summary.md** (Last Updated: 2026-04-15)
   - Removed sessionTtlDays reference
   - Updated onboarding endpoints list
   - Added rate limiting details
   - Updated AiConversation entity description

2. **docs/system-architecture.md** (Last Updated: 2026-04-15)
   - Updated onboarding flow diagram
   - Removed 7-day session TTL references
   - Updated subscription module flow (removed /subscriptions/sync)

3. **docs/project-overview-pdr.md** (Last Updated: 2026-04-15, Version: 1.8.0)
   - Updated onboarding feature description
   - Updated module endpoint list
   - Updated AiConversation entity description
   - Bumped version for consistency

4. **docs/project-roadmap.md** (Last Updated: 2026-04-15)
   - Removed "7-day TTL" from Phase 1
   - Added completion entries for resume support + session expiry removal

5. **docs/mobile-api-reference.md**
   - Removed 6 deprecated endpoint sections
   - Added comprehensive GET /onboarding/conversations/:conversationId/messages section
   - Clarified idempotent behavior of POST /onboarding/complete

6. **docs/api-documentation.md**
   - Updated onboarding session persistence (removed expiry)
   - Clarified "persist indefinitely" behavior

7. **docs/api/onboarding-api.md**
   - Updated conversationId validation description
   - Added idempotent label to /complete endpoint
   - Added complete GET /onboarding/conversations/:conversationId/messages section
   - Updated Session Lifecycle section

8. **docs/project-changelog.md** (Last Updated: 2026-04-15)
   - Added new entry "2026-04-15 — Session Expiry Removal"

## Removed Endpoint Documentation

Verified as truly removed from codebase (no endpoints found in src/):
- ✓ POST /subscriptions/sync
- ✓ POST /notifications/devices
- ✓ DELETE /notifications/devices/:token
- ✓ POST /ai/exercises/generate
- ✓ POST /ai/conversations
- ✓ GET /ai/conversations/:id/messages (authenticated, different from onboarding endpoint)

## Verification

**Stale References Cleaned:**
- All "7-day TTL" references on onboarding removed (except historical changelog entries)
- All `sessionTtlDays` references removed
- All "Session TTL" references updated or removed
- All deprecated endpoint documentation cleaned from current API references

**Cross-File Consistency:**
- All docs updated to reflect same onboarding behavior (idempotent /complete, new GET /messages, no session expiry)
- Last Updated dates synchronized to 2026-04-15
- Version bumped to 1.8.0 in PDR for consistency with API docs

**No Dangling References:**
- No broken internal links
- All code references verified against actual implementation
- No "TODO" or "update needed" markers left

## Status
**DONE** — All documentation updated and verified. Project docs now accurately reflect:
- Onboarding resume support (new GET endpoint)
- Idempotent profile extraction (POST /complete caching)
- Session expiry removal (no TTL on anonymous conversations)
- Removed API endpoints cleaned from docs
