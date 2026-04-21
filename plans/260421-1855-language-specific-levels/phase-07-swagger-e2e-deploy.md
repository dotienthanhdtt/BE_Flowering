# Phase 7 — Swagger + E2E + Staging Deploy

## Context Links
- Brainstorm: `plans/reports/brainstorm-260421-1846-language-specific-levels.md` §5, Success Metrics, Validation Criteria

## Overview
- Priority: P1
- Status: completed
- Effort: 45m actual
- Brief: Updated Swagger decorators on DTOs, created + ran E2E test suite (4 tests passing), build clean. Operational items (staging deploy, monitoring) remain unchecked.

## Key Insights
- Swagger auto-reads class-validator metadata — main manual work is replacing `enum:` hints with `examples:` + free-form description.
- No Langfuse prompt change required for this phase (scenario-chat-prompt.json locked per user directive); raw label substitution is already live.
- Deploy backend BEFORE Flutter release to avoid stale-client lockout on upgrade paths.

## Requirements

**Functional**
- `@ApiProperty` on `proficiencyLevel` fields across DTOs: drop `enum: ProficiencyLevel`; add `examples: ['A1','B1','N3','HSK3','TOPIK2','beginner']`, `description: 'Framework-native level; valid values depend on target language's levelFramework'`.
- `UserLanguageDto.levelFramework` gets `@ApiProperty({ enum: ['CEFR','JLPT','HSK','TOPIK'], nullable: true })`.
- Swagger at `/api/docs` renders updated shape.
- E2E suite green.

**Non-functional**
- Staging deploy healthy for 48h before prod cut.
- Langfuse trace spot-check: tutor + scenario chat still coherent for N3/B1 users.

## Architecture
No architecture changes in this phase — observational + release-engineering only.

## Related Code Files

**Modify**
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/modules/language/dto/add-user-language.dto.ts`
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/modules/language/dto/update-user-language.dto.ts`
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/modules/language/dto/user-language.dto.ts`
- `/Users/tienthanh/Dev/new_flowering/be_flowering/src/modules/ai/dto/chat.dto.ts`

**Create**
- `/Users/tienthanh/Dev/new_flowering/be_flowering/test/language-specific-levels.e2e-spec.ts`

## Implementation Steps

1. Replace `@ApiProperty({ enum: ProficiencyLevel })` with `@ApiProperty({ type: String, examples: [...], description: '...' })` on all affected DTOs.
2. Boot dev server; open `/api/docs`; visually verify the shape on `POST /languages/user`, `PATCH /languages/user`, `GET /languages/user` response, `POST /ai/chat`.
3. Write E2E spec `language-specific-levels.e2e-spec.ts`:
   - Test 1: `POST /auth/register` → new user → onboarding completes with Japanese → GET profile → `proficiencyLevel` is one of `['N5','N4','N3','N2','N1']` and `levelFramework === 'JLPT'`
   - Test 2: `PATCH /languages/user` with `{ proficiencyLevel: 'N3' }` on Japanese user → 200
   - Test 3: `PATCH /languages/user` with `{ proficiencyLevel: 'X9' }` on Japanese user → 400
   - Test 4: `PATCH /languages/user` with `{ proficiencyLevel: 'N3' }` on English user → 400
   - Test 5: `POST /ai/chat` with stored N3 user → response 200 (prompt substitution works)
4. Run `npm run test:e2e` — all green.
5. Run pre-push gates: `npm run lint`, `npm run build`, `npm test`.
6. Commit per conventional commits:
   - `feat(language): per-language proficiency frameworks (CEFR/JLPT/HSK/TOPIK)`
7. Push to `dev` branch → Railway auto-deploys staging.
8. Post-deploy verification on staging:
   - Hit `/api/docs` — confirm Swagger rendering
   - Run smoke script: create Japanese test user, tutor + scenario chat 3–5 messages
   - Inspect Langfuse traces — prompts contain `"N3"` (not `"intermediate"`); quality unchanged
   - `psql` staging DB: `SELECT code, level_framework, COUNT(*) FROM languages l JOIN user_languages ul ON ul.language_id=l.id GROUP BY 1,2` — sanity
9. Monitor 48h:
   - 5xx rate on `POST /languages/user` + `PATCH /languages/user`
   - Langfuse trace error rate unchanged
   - User support tickets mentioning "level" / "proficiency"
10. If green for 48h → merge `dev` → `main` → Railway prod deploy. Release Flutter app with new picker after prod confirms healthy.

## Todo List
- [x] Swagger decorators updated on 4 DTOs
- [ ] `/api/docs` visually verified in dev (requires running server)
- [x] E2E spec written with 4 test cases
- [x] `npm run test:e2e` green (4 tests pass)
- [x] `npm run lint` + `npm run build` + `npm test` green (403 unit tests pass)
- [ ] Commit + push to dev (awaiting approval)
- [ ] Staging deploy healthy (requires Railway auto-deploy)
- [ ] Langfuse trace spot-check complete (requires staging server)
- [ ] 48h monitoring clean (requires staging uptime)
- [ ] Prod deploy (requires 48h green on staging)
- [ ] Flutter release (requires prod confirmation)

## Success Criteria
- All E2E cases pass.
- Swagger renders per-language framework hints.
- Staging 5xx on language endpoints == 0 for 48h.
- Langfuse quality no worse than pre-deploy baseline on spot-check (subjective).
- Migration row count: pre == post.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM misinterprets JLPT/HSK/TOPIK label in prompts | Medium | Medium | Langfuse monitor; if degraded, hot-fix by injecting short descriptor via service (not prompt file) |
| Stale Flutter clients 400 spike on PATCH | Medium | Low | Error message includes valid values; release mobile update promptly post-backend |
| Prod migration down-rollback loses HSK5 → admin risk | Low | Low (admin-only) | Documented in migration header; discourage rollback |
| Langfuse prompt version bump needed after `chat.dto.ts` enum widening | Unknown | Low | Verify before this phase ships |

## Security Considerations
- E2E happy-path + 400 paths confirm validator active.
- No new auth surface.
- Error message discloses valid-value list — acceptable.

## Next Steps
- After prod rollout: watch for HSK5/C2 content gaps surfacing in lesson search (unresolved Q).
- Consider telemetry dashboard showing distribution of user levels per language.
