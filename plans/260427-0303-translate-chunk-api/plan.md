---
title: "Chunk-Aware Translation API"
description: "New POST /ai/translate/word endpoint translating context-aware chunks (idioms, phrasal verbs, compound nouns) using Gemini 3.1 flash-lite via tap-range on existing chat message."
status: complete
priority: P2
effort: 3h
branch: feat/translate-chunk-api
tags: [ai, translation, vocabulary, gemini, llm]
created: 2026-04-27
blockedBy: []
blocks: []
---

# Chunk-Aware Translation API

## Summary
Add `POST /ai/translate/word` for context-aware chunk translation. Client sends `messageId` + tap range; backend resolves the smallest meaning-bearing chunk (word/phrase/idiom/phrasal_verb/compound_noun/particle) using `prompts/translate_word.md` against `gemini-3.1-flash-lite-preview`, then upserts result into `vocabulary` table. Adds `type` column to vocabulary; persists `pronunciation`.

## Brainstorm Report
- [brainstorm-260427-0258-translate-chunk-api.md](../reports/brainstorm-260427-0258-translate-chunk-api.md)

## Phases
- [Phase 1 — DB migration + entity](./phase-01-db-migration-entity.md) — COMPLETE — add `type` column to vocabulary, register entity field
- [Phase 2 — Prompt + service](./phase-02-prompt-and-service.md) — COMPLETE — extend prompt with pronunciation, add `translateChunk` method
- [Phase 3 — DTO + controller route](./phase-03-dto-and-controller.md) — COMPLETE — new DTO, wire `POST /ai/translate/word`
- [Phase 4 — Tests + manual verification](./phase-04-tests.md) — COMPLETE — unit tests, build/lint, curl smoke

## Key Dependencies
- Existing `TranslationService`, `UnifiedLLMService`, `PromptLoaderService`
- `LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW` (already wired)
- `Vocabulary` entity + migrations data source
- Global JWT guard (route is authed-only)

## Success Definition
- Endpoint returns valid JSON `{text, type, from, to, translation, pronunciation, vocabularyId}`
- Vocab row created with `type` and `pronunciation` populated
- Idiom/compound-noun cases resolve full chunk (not single token)
- Existing `POST /ai/translate` regression-clean
- All tests pass; `npm run build` clean
