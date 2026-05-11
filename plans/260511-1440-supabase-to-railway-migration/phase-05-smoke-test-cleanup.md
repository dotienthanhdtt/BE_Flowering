# Phase 05 — Smoke test + cleanup

**Priority:** high · **Status:** pending · Depends: Phase 02, 04

## Smoke tests (dev, against Railway)
1. `npm run migration:run` → green, only the new drop-RLS migration applies.
2. App boots; `GET /api/docs` loads.
3. Google/Firebase login works (`POST /auth/firebase`) → token issued, `users` row read/written.
4. Start an AI conversation → message rows persist in `ai_conversations` / `ai_conversation_messages` on Railway.
5. `POST` audio to the transcribe endpoint → file lands in Railway bucket `compact-samosa-4waqziim5o`; returned signed URL resolves (200, audio downloads).
6. Hit a scenario/lessons endpoint that reads `languages` → `flag_url` images still load.
7. Row-count parity vs Supabase for `users`, `ai_conversations`, `ai_conversation_messages`, `languages`, `user_languages`.

## Cleanup
- [ ] **Rotate** the Railway DB password and bucket access keys (both were pasted in chat). Update `.env` + Railway vars.
- [ ] Run `npm run lint` + `npm test` (DO NOT skip failing tests).
- [ ] `npm run build` clean.
- [ ] Update `docs/` — `system-architecture.md` (data store now Railway), `code-standards.md` / `codebase-summary.md` if storage service renamed. Add changelog entry.
- [ ] Note remaining debt in plan: `languages.flag_url` still on Supabase Storage; prod migration not done; `SUPABASE_*` vars removable once flags re-hosted.
- [ ] Optionally tear down / pause the Supabase dev project once parity confirmed and flags re-hosted.

## Todo
- [ ] All smoke tests pass
- [ ] Rotate credentials
- [ ] lint + test + build green
- [ ] docs updated
- [ ] debt noted
