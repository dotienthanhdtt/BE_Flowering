# Phase 10 — Langfuse Tagging + Observability

## Context Links
- Brainstorm §8 item 10, §9 metrics
- Phase 01 (LangfuseFeature enum additions)

## Overview
- **Priority:** P2
- **Status:** pending
- **Description:** Tag all personalization LLM calls with Langfuse features; add counters for trigger fires, dedup skips, paywall hits. Feeds success metrics dashboard.

## Key Insights
- Langfuse trace already wired in `IntakeChatEngine` (Phase 02) — just pass feature tag from config.
- Counters via existing logger or simple Prometheus-style metric service if present; if not, structured log lines `metric=name value=1` for downstream parsing.

## Requirements
**Functional:**
- Each LLM call in personalization tagged: `PERSONALIZATION_CHAT` (turn), `PERSONALIZATION_EXTRACTION` (extract), `PERSONALIZATION_SCENARIOS` (generate).
- Counters: `personalization.trigger.fired`, `personalization.dedup.skipped`, `personalization.paywall.hit`, `personalization.daily_ceiling.hit`, `personalization.generated`.
- Each counter tagged with `tier` dimension (premium / premium_plus).

**Non-Functional:**
- Zero LLM calls untagged.
- Counter overhead negligible.

## Architecture
- Engine config carries `langfuseFeature: LangfuseFeature` per call type.
- Personalization service calls `metricsService.increment(name, {tier})` at decision points.

## Related Code Files
**Modify:**
- `src/modules/ai/services/intake-chat-engine.service.ts` — accept per-call feature tag
- `src/modules/personalization/personalization.service.ts` — increment counters
- `src/modules/personalization/services/personalization-trigger.service.ts` — fire counter
- `src/modules/personalization/services/personalization-dedup.service.ts` — skip counter
- `src/modules/personalization/services/personalization-quota.service.ts` — paywall + ceiling counters

**Create:**
- `src/modules/personalization/services/personalization-metrics.service.ts` (thin wrapper over logger or metrics module)

**Delete:** none

## Implementation Steps
1. Confirm Langfuse trace wiring in engine; ensure feature tag is part of trace metadata.
2. Pass `LangfuseFeature.PERSONALIZATION_CHAT` to chat-turn LLM calls.
3. Pass `PERSONALIZATION_EXTRACTION` to extraction calls.
4. Pass `PERSONALIZATION_SCENARIOS` to generation calls.
5. Create `PersonalizationMetricsService` with `increment(name, dims)` → log line or real metrics.
6. Increment at trigger fire, dedup skip, paywall hit, daily ceiling, successful generation.
7. Verify in Langfuse dev project: traces appear with correct feature tag.
8. `npm run build`.

## Todo List
- [ ] Engine accepts feature tag per call
- [ ] All 3 personalization LLM call sites tagged
- [ ] MetricsService created
- [ ] 5 counter call sites
- [ ] Langfuse dev verification
- [ ] Build clean

## Success Criteria
- Langfuse dev shows traces filterable by `feature=PERSONALIZATION_*`.
- Log/metric stream shows expected counter increments during e2e tests.
- No LLM call in personalization missing a feature tag.

## Risk Assessment
- **Langfuse outage masks issues** → metrics independent of Langfuse (separate counters).
- **High-cardinality dimensions** → only `tier` dim added; safe.

## Security Considerations
- Do NOT log full profile snapshot or scenario content in metrics — only counts.

## Next Steps
- Plan complete. Mobile work tracked in separate `app_flowering` plan.
