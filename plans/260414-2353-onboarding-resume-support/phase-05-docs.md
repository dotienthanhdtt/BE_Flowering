# Phase 05 — Docs Update

## Context Links

- Target docs: `docs/api-documentation.md`, `docs/project-changelog.md`
- Plan: `plan.md`

## Overview

- Priority: P2
- Status: pending
- Document new GET endpoint + idempotent POST /complete behavior.
- Add changelog entry.

## Requirements

- Swagger auto-updates (via controller decorators) — verify by visiting `/api/docs`.
- Manual docs: `api-documentation.md` entry + `project-changelog.md` entry.

## Related Code Files

**Modify:**
- `docs/api-documentation.md`
- `docs/project-changelog.md`

## Implementation Steps

### Step 1 — `api-documentation.md`

Append to the Onboarding section:

```markdown
### GET /onboarding/conversations/:conversationId/messages

**Auth:** public. **Throttler:** 30/hr per IP.

Fetch full transcript for an anonymous onboarding conversation. Used by mobile to rehydrate chat UI on resume.

**Path param:** `conversationId` (UUID v4).

**200:**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
    "turn_number": 3,
    "max_turns": 10,
    "is_last_turn": false,
    "messages": [
      {"id": "...", "role": "assistant", "content": "Hello!", "created_at": "2026-04-14T23:20:00Z"},
      {"id": "...", "role": "user", "content": "I want to learn English", "created_at": "2026-04-14T23:21:00Z"}
    ]
  }
}
```

**404:** conversation not found or not an anonymous onboarding session.
```

Also update the `POST /onboarding/complete` section to note:

> **Idempotent.** Second+ calls with same `conversation_id` return cached profile + scenarios (same scenario UUIDs) without re-invoking the LLM. Cache is populated on the first successful call (structured profile + 5 scenarios); partial failures skip caching and retry next call.

### Step 2 — `project-changelog.md`

Prepend entry under current date:

```markdown
## 2026-04-14

### Added

- `GET /onboarding/conversations/:conversationId/messages` — fetch anonymous onboarding transcript for mobile resume UX.

### Changed

- `POST /onboarding/complete` is now idempotent. Cached `extracted_profile` + `scenarios` columns added to `ai_conversations`. Second call returns same data with stable scenario UUIDs; no extra LLM tokens.

### Database

- Migration `1776100000000-add-onboarding-cache-to-ai-conversations` adds `extracted_profile JSONB NULL` + `scenarios JSONB NULL` to `ai_conversations`. No backfill required.
```

### Step 3 — Verify Swagger

`npm run start:dev` → browse `http://localhost:3000/api/docs` → confirm:
- `GET /onboarding/conversations/{conversationId}/messages` listed under onboarding tag
- Request/response examples render

## Todo List

- [ ] Append GET endpoint spec to `api-documentation.md`
- [ ] Note idempotency in `POST /complete` section
- [ ] Add changelog entry dated 2026-04-14
- [ ] Confirm Swagger `/api/docs` shows new endpoint

## Success Criteria

- Docs files updated + committed.
- Swagger shows new endpoint with example.

## Risk Assessment

- **Risk:** Stale doc reference to unchanged `POST /complete` contract. **Mitigation:** only the idempotency note is added; request/response shape unchanged.

## Security Considerations

- N/A (docs only).

## Next Steps

- Notify mobile team that backend is ready for Phase 04 resume implementation.
- Confirm migration applied in staging before mobile release.
