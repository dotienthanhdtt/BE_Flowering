# Onboarding Resume Support — Documentation Update

**Date:** 2026-04-14
**Status:** DONE
**Agent:** docs-manager

## Summary

Updated API documentation and changelog to reflect shipped onboarding resume feature. Two files modified: `api-documentation.md` and `project-changelog.md`.

## Changes Made

### 1. `docs/api-documentation.md`

**Location:** Onboarding section (line 998)

**Added:**
- New `GET /onboarding/conversations/:conversationId/messages` endpoint documentation
  - Auth: public, 30/hr throttle per IP
  - Purpose: fetch full transcript for resume UX
  - Request: path param `conversationId` (UUID v4)
  - Response: 200 with `conversation_id`, `turn_number`, `max_turns`, `is_last_turn`, `messages[]`
  - Each message: `id`, `role`, `content`, `created_at`
  - Error: 404 if conversation not found or not onboarding session

**Updated:**
- `POST /onboarding/complete` section now includes idempotency note
  - Explains cached `extracted_profile` + `scenarios` columns
  - Clarifies second call returns same data without LLM re-invocation
  - Documents cache population rule (full success only)

### 2. `docs/project-changelog.md`

**Location:** Line 7 (prepended to existing entries)

**Added:**
- New `2026-04-14 — Onboarding Resume Support` section with:
  - **Added:** GET endpoint for transcript fetching
  - **Changed:** POST /complete idempotency + caching behavior
  - **Database:** Migration name + column additions (extracted_profile JSONB, scenarios JSONB)

Note: Prepended before existing "2026-04-14 — BREAKING: Onboarding Endpoint Consolidation" entry to maintain chronological clarity.

## Verification

- All field names use `snake_case` per API contract (conversion via middleware)
- Wrapper format matches `{code, message, data}` standard
- Response field names: `conversation_id`, `turn_number`, `max_turns`, `is_last_turn`, `messages[]`
- Message fields: `id`, `role`, `content`, `created_at`
- Migration name and columns match phase-05-docs.md spec exactly
- No broken links or cross-references introduced

## Files Modified

1. `/Users/tienthanh/Dev/new_flowering/be_flowering/docs/api-documentation.md` — ~30 lines added (GET endpoint + idempotency note)
2. `/Users/tienthanh/Dev/new_flowering/be_flowering/docs/project-changelog.md` — ~10 lines prepended (2026-04-14 entry)

## Skipped

- `docs/system-architecture.md` — onboarding flow diagram exists but requires no update; new endpoint is metadata-only, no architectural change
- `docs/development-roadmap.md` — file does not exist in repo; skip per rules

## Notes

- Phase spec content was used verbatim for accuracy
- No refactoring of unrelated doc sections performed
- Idempotency note placement in POST /complete section preserves existing request/response schema documentation
