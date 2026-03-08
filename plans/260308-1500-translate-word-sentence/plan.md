---
title: "Translate Word & Sentence Feature"
description: "Single POST /ai/translate endpoint with word vocabulary storage and sentence translation caching"
status: completed
priority: P2
effort: 3h
branch: feat/translate-word-sentence
tags: [ai, translation, vocabulary, llm]
created: 2026-03-08
---

# Translate Word & Sentence Feature

## Summary
Add translation capability to AI learning module. Single `POST /ai/translate` endpoint handles both word and sentence translation via LLM. Words saved to user-scoped vocabulary table; sentence translations cached on message row.

## Brainstorm Report
- [brainstorm-260308-1500-translate-word-sentence.md](../reports/brainstorm-260308-1500-translate-word-sentence.md)

## Phases

| # | Phase | Status | Effort |
|---|-------|--------|--------|
| 1 | [Database: migration + entities](phase-01-database-migration-and-entities.md) | complete | 30m |
| 2 | [Translation service + prompts](phase-02-translation-service-and-prompts.md) | complete | 1h |
| 3 | [API endpoint + DTO](phase-03-api-endpoint-and-dto.md) | complete | 45m |
| 4 | [Testing](phase-04-testing.md) | complete | 45m |

## Dependencies
- UnifiedLLMService (existing)
- PromptLoaderService (existing)
- AiConversationMessage entity (modify)
- AI module (modify)

## Key Decisions
- LLM-powered translation (Gemini Flash default)
- User-scoped vocabulary with UNIQUE constraint
- Sentence translation cached as columns on ai_conversation_messages
- Single endpoint with type discriminator
- Word response includes: translation, partOfSpeech, pronunciation
