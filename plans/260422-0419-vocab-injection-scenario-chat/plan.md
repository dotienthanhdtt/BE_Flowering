---
title: "Personalized Vocabulary Injection in Scenario Chat"
description: "Inject 0-10 SRS-selected vocab per user into scenario-chat prompt turn-1, cache IDs on conversation, track usage events."
status: done
priority: P1
effort: 8h
branch: feat/personalized-feature
tags: [backend, ai, scenario-chat, vocabulary, srs, personalization]
created: 2026-04-22
brainstorm: plans/reports/brainstorm-260422-0405-vocab-injection-scenario-chat.md
blockedBy: []
blocks: []
---

## Summary

Personalize `POST /scenario/chat` by injecting each user's active vocabulary (hybrid: recency rotation + SRS-due) into the prompt. Selection runs turn-1, IDs cached in `ai_conversations.injected_vocab_ids`, hydrated on subsequent turns. Usage-in-reply is tracked in a new `vocabulary_injection_events` table and counted as a lightweight review touch (updates `lastReviewedAt` + `reviewCount` only — no box/correctCount changes).

## Phases

| #  | Phase                                                                          | Status | One-liner                                                                                      |
|----|--------------------------------------------------------------------------------|--------|------------------------------------------------------------------------------------------------|
| 01 | [Schema & Migrations](./phase-01-schema-migrations.md)                         | done   | 2 migrations: `injected_vocab_ids uuid[]` + indexes + new events table + entity registration   |
| 02 | [Vocabulary Injection Service](./phase-02-vocabulary-injection-service.md)     | done   | New service with two-bucket query + dedup + config file; unit-tested                           |
| 03 | [Scenario-Chat Wiring](./phase-03-scenario-chat-wiring.md)                     | done   | Turn-1 select + persist, turn-2+ hydrate, update prompt JSON with `userVocabulary` var         |
| 04 | [Usage Tracking & Touch-Review](./phase-04-usage-tracking.md)                  | done   | Naive word-match after user msg; fire-and-forget event insert; touch-review hit words          |
| 05 | [Tests & E2E](./phase-05-tests-and-e2e.md)                                     | done   | Unit + e2e: empty vocab, mastered-only, normal path, cache reuse, used-word tracking           |

## Key Dependencies

- `Vocabulary` entity SRS fields already exist (`box`, `dueAt`, `lastReviewedAt`, `reviewCount`, `correctCount`).
- `AiConversation` entity + `ScenarioChatService` already handle turn-by-turn persistence.
- `PromptLoaderService` already handles `{{var}}` substitution — new variable flows through existing path.
- Phases are strictly sequential (01 → 02 → 03 → 04 → 05). No parallelizable slices.

## Success Criteria (Rollup)

- `/scenario/chat` returns same shape; prompt receives 0–10 personalized words at turn 1.
- Turn-1 latency added ≤ 50 ms; turn 2+ latency unchanged (hydration is one `WHERE id = ANY`).
- Users with 0 vocab or all-mastered vocab see no errors, empty array injected.
- `vocabulary_injection_events` accumulates rows per turn with correct `was_used` boolean.
- Words appearing in user reply have `lastReviewedAt` + `reviewCount` bumped, box/correctCount untouched.
- Config-only tune of `totalWords` / bucket sizes takes effect without code changes.
