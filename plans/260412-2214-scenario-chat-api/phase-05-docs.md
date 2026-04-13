# Phase 05: Documentation Updates

## Context Links
- Docs dir: `./docs/`
- Key files: `api-documentation.md`, `project-changelog.md`, `codebase-summary.md`

## Overview
- Priority: P2
- Status: complete
- Effort: S (30m)

Update project docs to reflect new endpoint + entity change.

## Requirements

**Functional**
- `api-documentation.md` — add `POST /scenario/chat` section with request/response schema + example curl.
- `project-changelog.md` — add entry under current version.
- `codebase-summary.md` — note new `scenario-chat` service under AI module summary if relevant.
- `system-architecture.md` — add scenario chat flow if other chat flows documented.

**Non-functional**
- Keep docs concise, accurate references to actual code.
- Update schema references (mention new `scenarioId` column on `ai_conversations`).

## Related Code Files

**Modify**
- `docs/api-documentation.md`
- `docs/project-changelog.md`
- `docs/codebase-summary.md`
- `docs/system-architecture.md` (if flows documented)

## Implementation Steps

1. Read current state of each doc file.
2. Add `POST /scenario/chat` section to API docs with:
   - Description
   - Request body schema
   - Response schema
   - Example curl
   - Error codes (400, 401, 403, 404, 429)
3. Add changelog entry:
```
### Added
- `POST /scenario/chat` — AI-powered scenario roleplay chat with 12-turn cap, resumable per (userId, scenarioId)
- `ai_conversations.scenario_id` column + partial index
```
4. Update codebase summary if it enumerates modules.
5. Verify no broken links.

## Todo List

- [x] Update `api-documentation.md` with `/scenario/chat` section
- [x] Update `project-changelog.md` with entry
- [x] Update `codebase-summary.md` if module list present
- [x] Update `system-architecture.md` if chat flows documented
- [x] Cross-check all doc references point to real files/methods

## Success Criteria

- All 4 doc files updated consistently
- Example curl matches real endpoint behavior
- No broken cross-references
- Changelog entry under correct version heading

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Docs drift from code | Verify against actual controller/DTO after Phase 03 |
| Missing doc file | Use `ls docs/` first; create only if user requests |

## Next Steps
- Delegate docs manager agent OR perform inline. Invoke `code-reviewer` after docs update for final review.
