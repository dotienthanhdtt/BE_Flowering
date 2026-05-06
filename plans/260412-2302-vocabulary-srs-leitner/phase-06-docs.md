# Phase 06: Documentation Updates

## Context Links
- Docs dir: `./docs/`

## Overview
- Priority: P2
- Status: pending
- Effort: S (30m)

Update project docs for new vocabulary endpoints + SRS schema change.

## Requirements

- `docs/api-documentation.md` — add 6 new endpoints:
  - `GET /vocabulary`
  - `GET /vocabulary/:id`
  - `DELETE /vocabulary/:id`
  - `POST /vocabulary/review/start`
  - `POST /vocabulary/review/:sessionId/rate`
  - `POST /vocabulary/review/:sessionId/complete`
- `docs/project-changelog.md` — add entry:
  - New: `/vocabulary` CRUD endpoints
  - New: Leitner 5-box SRS with review sessions
  - Schema: `vocabulary` adds `box`, `due_at`, `last_reviewed_at`, `review_count`, `correct_count`
- `docs/system-architecture.md` — add Leitner review flow (if flows documented)
- `docs/codebase-summary.md` — note new `VocabularyModule` in module list

## Implementation Steps

1. Read current doc files.
2. Add new endpoints section with: path, method, auth, body, response, example curl, error codes.
3. Add changelog entry under current version.
4. Document Leitner intervals in architecture doc:
   - Box 1 → 2: 3 days
   - Box 2 → 3: 7 days
   - Box 3 → 4: 14 days
   - Box 4 → 5: 30 days
   - Box 5 → 5: 30 days (cap)
   - Any → 1 on wrong: 1 day
5. Cross-check references point to real files/methods.

## Todo List

- [ ] Update `api-documentation.md` with 6 new endpoints
- [ ] Update `project-changelog.md`
- [ ] Update `codebase-summary.md` module list
- [ ] Update `system-architecture.md` if chat/feature flows documented
- [ ] Verify all cross-references

## Success Criteria

- All relevant docs reflect new state
- Example curl matches real behavior
- Leitner intervals documented exactly as implemented
- No broken cross-references

## Next Steps
- Invoke `/ck:journal` to log completion
- Consider follow-up: DB-backed review sessions (multi-pod), SM-2 upgrade, AI-generated quiz questions
