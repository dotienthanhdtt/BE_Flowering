---
phase: 1
title: "Create HTTP Logger Middleware & Remove SQL Logging"
status: pending
priority: P3
---

# Phase 1: Create HTTP Logger Middleware & Remove SQL Logging

## Context
- [Plan](./plan.md)
- [NestJS Middleware docs](https://docs.nestjs.com/middleware)

## Overview
Create NestJS middleware for HTTP request logging, apply globally, remove TypeORM SQL logging.

## Related Code Files

### Modify
- `src/app.module.ts` - implement `NestModule` interface, add `configure()` method
- `src/database/database.module.ts` - set `logging: false`

### Create
- `src/common/middleware/http-logger.middleware.ts` - HTTP logging middleware

## Implementation Steps

### Step 1: Create HTTP Logger Middleware
Create `src/common/middleware/http-logger.middleware.ts`:
- Import `Injectable`, `NestMiddleware`, `Logger` from `@nestjs/common`
- Implement `NestMiddleware.use(req, res, next)`
- Record start time via `Date.now()`
- Listen to `res.on('finish')` to log after response completes
- Log format: `[HTTP] GET /api/users 200 +45ms`
- Use `Logger` with context `'HTTP'`

### Step 2: Apply Middleware Globally in AppModule
- `AppModule` implements `NestModule`
- Add `configure(consumer: MiddlewareConsumer)` method
- Apply `HttpLoggerMiddleware` to all routes: `consumer.apply(HttpLoggerMiddleware).forRoutes('*')`

### Step 3: Remove SQL Logging
- In `src/database/database.module.ts` line 52, change `logging: configService.get<string>('nodeEnv') === 'development'` to `logging: false`

### Step 4: Export middleware from common barrel
- Add export in `src/common/index.ts` if barrel file exists

## Todo List
- [ ] Create `http-logger.middleware.ts`
- [ ] Update `AppModule` to apply middleware globally
- [ ] Set TypeORM `logging: false`
- [ ] Export from common barrel (if applicable)

## Success Criteria
- HTTP requests logged to console: method, URL, status, response time
- No SQL queries logged to console
- Build passes (`npm run build`)
- Tests pass (`npm test`)
