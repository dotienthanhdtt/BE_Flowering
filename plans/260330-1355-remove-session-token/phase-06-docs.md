# Phase 6: Documentation

**Status:** Pending
**Priority:** Low

## Overview

Update all documentation to reflect `conversationId` replacing `sessionToken`.

## Files to Modify

- `docs/api/onboarding-api.md`
- `docs/api/auth-api.md`
- `docs/api/translate-api.md`
- `docs/api-documentation.md`
- `docs/mobile-api-reference.md`
- `docs/project-overview-pdr.md`
- `docs/project-changelog.md`
- `docs/codebase-summary.md`

## Implementation Steps

1. Replace all `sessionToken` / `session_token` references with `conversationId` / `conversation_id`
2. Update API request/response examples
3. Update field descriptions
4. Add changelog entry for this breaking API change

## Success Criteria

- No `sessionToken`/`session_token` references remain in docs (except historical changelog)
- API examples match new contract
