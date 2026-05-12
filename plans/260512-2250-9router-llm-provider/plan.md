---
title: Add 9router LLM provider + route scenario chat through it
status: completed
created: 2026-05-12
completed: 2026-05-12
mode: auto
blockedBy: []
blocks: []
---

# 9router LLM Provider

Add `9router` (OpenAI-compatible AI gateway) as an additional LLM provider. Keep all existing
providers (OpenAI / Anthropic / Gemini). Switch **scenario roleplay chat** to use 9router's
`flowering_chat` model, with auto-fallback to Gemini on 9router failure.

## Source
Brainstorm session 2026-05-12. 9router skill docs:
https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router/SKILL.md
Reference curl: `POST https://9router-dev.up.railway.app/v1/chat/completions`, `Authorization: Bearer <key>`,
`{"model":"flowering_chat","messages":[...],"stream":true}`

## Decisions (from brainstorm)
- Switch scope: **scenario roleplay chat only** (`ScenarioChatService`). `/ai/chat` tutor + onboarding intake stay on Gemini.
- Config: env vars, **key required** — `NINEROUTER_URL` (default `https://9router-dev.up.railway.app`), `NINEROUTER_KEY` (no committed default; secret).
- Failure handling: scenario chat **auto-falls back to `GEMINI_3_1_FLASH_LITE_PREVIEW`** once on `ServiceUnavailableException`, logged.
- Out of scope (YAGNI): 9router STT/image/TTS/embeddings; no removal of existing providers; streaming path unchanged (scenario chat uses non-streaming `.chat()`).

## Phases
| # | Phase | Status |
|---|-------|--------|
| 01 | [Provider + config + wiring](phase-01-provider-config-wiring.md) | completed |
| 02 | [Scenario chat switch + fallback + tests/docs](phase-02-scenario-switch-tests-docs.md) | completed |

## Key dependencies
- LangChain `@langchain/openai` `ChatOpenAI` supports `configuration.baseURL` — already a dependency, no new package.
- Phase 02 depends on Phase 01 (needs `LLMModel.NINEROUTER_FLOWERING_CHAT` + provider wired).

## Definition of done
- `npm run build` clean, `npm test` green.
- New `NineRouterLLMProvider` registered; `flowering_chat` routes to it via `UnifiedLLMService`.
- Scenario chat default model = `flowering_chat`; Gemini fallback path covered by a test.
- `.env.example`, validation schema, app-configuration updated; docs + changelog updated.
