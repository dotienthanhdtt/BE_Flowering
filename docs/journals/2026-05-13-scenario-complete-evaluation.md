# Scenario Complete Evaluation Endpoint Implementation

**Date**: 2026-05-13 15:27
**Severity**: Medium
**Component**: AI module / scenario evaluation
**Status**: Resolved

## What Happened

Shipped `POST /scenario/complete` endpoint with LLM-powered scenario evaluation. Backend now grades user dialogue against learning objectives, triggers personalization, and caps retries via tombstone pattern.

## The Decision That Almost Broke Us

We initially designed the flow with LLM calls inside the DB transaction. This created pool starvation: 10 connections × 15s LLM timeout = 150s of blocked pool, with just 2-3 concurrent requests. Realized too late during load testing that Rails-style transaction patterns don't scale when external services are involved.

**The fix:** Moved LLM call outside the transaction, kept advisory lock for INSERT deduplication. Tradeoff: rare concurrent `/complete` requests now fire duplicate LLM calls (idempotent anyway; gets same grade twice), but we avoid pool exhaustion entirely. Transaction now ~10ms instead of ~15s.

This hurts, but less than 500 errors on concurrent requests.

## Technical Details

- Migration 1781200000000: `scenario_evaluations` table with `(userId, conversationId)` UNIQUE constraint + soft delete flag for tombstone retry capping
- `ScenarioEvaluatorService`: 15s timeout with Gemini fallback; vocab-usage re-match regex for legacy conversations missing structured LLM output
- Timer handle cleared explicitly on LLM win to prevent unhandled rejection from timeout Promise (was getting swallowed in tests, caught it)
- New `scenario-complete` throttle bucket: 30 req/min per user (conservative given async re-matching)
- 51 new unit tests, all passing

## Root Cause of the Pool Decision

Didn't model connection lifetime against LLM latency upfront. Assumed "just wrap it in a transaction" without considering that each open transaction holds a connection. Should have done back-of-envelope math on day one: 10 pool size ÷ 15s timeout = 0.66 req/s sustainable throughput. Unacceptable.

## What Sticks

- **Never nest external service calls inside transactions** — move them outside, use advisory locks for correctness
- Duplicate idempotent calls are cheaper than pool exhaustion
- Explicit timer cleanup prevents silent rejection swallowing in async code

## Next Steps

Monitor `/scenario/complete` latency in production. If p95 > 5s (LLM slow), consider circuit breaker or queue. Personalization trigger is dual-firing during transition; clean up when scenario v1 routes sunset.

**Commit**: c5ea51e (all tests passing, 617 total)
