---
title: "Add HTTP Logger, Remove SQL Logger"
description: "Add HTTP request logging middleware to console, remove TypeORM SQL query logging"
status: pending
priority: P3
effort: 30m
branch: feat/auth-improvements-onboarding-linking
tags: [logging, middleware, devex]
created: 2026-03-07
---

# Add HTTP Logger, Remove SQL Logger

## Goal
Replace TypeORM SQL query logging with HTTP request logging middleware for better visibility into API traffic.

## Phases

| # | Phase | Status | Effort |
|---|-------|--------|--------|
| 1 | [Create HTTP logger middleware & remove SQL logging](./phase-01-http-logger-middleware.md) | pending | 20m |
| 2 | [Verify build & test](./phase-02-verify-build-test.md) | pending | 10m |

## Key Files
- `src/common/middleware/http-logger.middleware.ts` (create)
- `src/app.module.ts` (modify - apply middleware)
- `src/database/database.module.ts` (modify - remove SQL logging)

## Approach
- Use NestJS built-in `Logger` class (no external deps)
- Create `HttpLoggerMiddleware` implementing `NestMiddleware`
- Log: method, URL, status code, response time in ms
- Apply globally via `AppModule.configure()`
- Set TypeORM `logging: false`
