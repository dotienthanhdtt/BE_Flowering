---
title: "Scenarios Grouped by Category (Per-Language)"
description: "Replace /scenarios/default + /scenarios/personal with single GET /scenarios returning categories grouped per active language. Refactor scenario_categories to language-scoped rows with slug. Seed per-language 'For you' category. DB trigger auto-defaults NULL category_id. Personalization stamps inherited or 'For you' category at creation."
status: completed
priority: P2
branch: "dev"
tags: [scenarios, categories, i18n, personalization, breaking-api]
blockedBy: []
blocks: []
context: ../reports/brainstorm-260516-1333-scenarios-grouped-by-category.md
created: "2026-05-16T07:22:22.391Z"
createdBy: "ck:plan"
source: skill
---

# Scenarios Grouped by Category (Per-Language)

## Overview

Client now displays scenarios grouped by category. A single category bucket must mix system, KOL, and personal scenarios. Today personal scenarios have `category_id=NULL` and categories are global, so per-language grouping is impossible.

This plan:
- Adds `slug` + `language_id` to `scenario_categories`; clones existing categories per active language; backfills `scenarios.category_id` to language-matched clones.
- Seeds one `for_you` category per active language.
- Installs DB trigger on `scenarios` BEFORE INSERT/UPDATE that defaults NULL `category_id` to per-language `for_you`.
- Adds `ai_conversations.source_scenario_id` so trigger-flow personal scenarios inherit parent category.
- Replaces `/scenarios/default` + `/scenarios/personal` with single `GET /scenarios` returning paginated categories with mixed-source items, sorted within category by `COALESCE(usa.granted_at, s.created_at) DESC`.

**Source brainstorm:** `../reports/brainstorm-260516-1333-scenarios-grouped-by-category.md`

**Breaking change:** old listing endpoints removed in same release — coordinate with mobile build.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Schema: language-scoped categories](./phase-01-schema-language-scoped-categories.md) | Completed |
| 2 | [Seed For you + default-category trigger](./phase-02-seed-for-you-default-category-trigger.md) | Completed |
| 3 | [ai_conversations.source_scenario_id](./phase-03-ai-conversations-source-scenario-id.md) | Completed |
| 4 | [Personalization category stamping](./phase-04-personalization-category-stamping.md) | Completed |
| 5 | [Unified GET /scenarios endpoint](./phase-05-unified-get-scenarios-endpoint.md) | Completed |
| 6 | [KOL + null-category backfill audit](./phase-06-kol-null-category-backfill-audit.md) | Completed |
| 7 | [Specs + cleanup + integration tests](./phase-07-specs-cleanup-integration-tests.md) | Completed |

## Dependencies

- Phase 1 → Phase 2 (categories must exist before trigger references `slug='for_you'`)
- Phase 2 → Phase 4 (personalization stamps `for_you` category)
- Phase 3 → Phase 4 (source_scenario_id column needed for inherit-parent logic)
- Phase 1, 2, 6 → Phase 5 (visibility query depends on language-scoped categories + filled category_ids)
- Phase 1–6 → Phase 7 (tests verify final integrated behavior)

## Cross-plan dependencies

None active. Related (completed): `260513-1931-onboarding-personal-materialization`, `260504-0218-auto-generate-personalized-scenarios`, `260501-1146-centralize-scenarios`.

## Risks

| Risk | Mitigation |
|---|---|
| Cross-language scenario→category mismatch after backfill | Invariant check post-migration: `SELECT COUNT(*) FROM scenarios s JOIN scenario_categories c ON c.id = s.category_id WHERE s.language_id <> c.language_id` must return 0 |
| Trigger raises on insert for languages without `for_you` row | Migration order: seed all `for_you` rows before trigger install; add language-add runbook step |
| Mobile clients on old endpoints | Hard cut; coordinate app version gate |
| Personal scenarios with NULL category before trigger | Phase 6 backfill explicitly fills via slug join before trigger creation |
