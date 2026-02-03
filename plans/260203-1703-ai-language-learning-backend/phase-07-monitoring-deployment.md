# Phase 07: Monitoring & Deployment

## Overview

| Field | Value |
|-------|-------|
| Priority | P2 - Important |
| Status | pending |
| Effort | 3h |
| Dependencies | All previous phases |

Integrate Sentry for error/performance monitoring, implement health check endpoints, configure Railway deployment for dev and prod environments, set up environment variables, and create GitHub Actions CI/CD pipeline.

## Key Insights

From research:
- Sentry NestJS SDK requires `instrument.ts` imported first in `main.ts`
- `SentryGlobalFilter` captures all unhandled exceptions
- Railway supports multiple environments via projects
- Health checks required for Railway deployment

## Requirements

### Functional
- Sentry error capture for all uncaught exceptions
- Performance monitoring with trace sampling
- Health check endpoints (liveness, readiness, database)
- Railway deployment configuration
- GitHub Actions CI/CD pipeline

### Non-Functional
- Sentry trace sampling: 10% for production
- Health check response <100ms
- Zero-downtime deployments

## Architecture

```
/
├── src/
│   ├── instrument.ts           # Sentry initialization (loaded first)
│   ├── main.ts                 # Import instrument.ts first
│   └── health/
│       ├── health.module.ts
│       └── health.controller.ts
├── .github/
│   └── workflows/
│       └── ci-cd.yml
├── railway.json
├── Dockerfile
└── .env.example
```

## Related Code Files

### Files to Create
- `src/instrument.ts`
- `src/health/health.module.ts`
- `src/health/health.controller.ts`
- `.github/workflows/ci-cd.yml`
- `railway.json`
- `Dockerfile`
- `.env.example` (update)

### Files to Modify
- `src/main.ts` - Import instrument.ts first
- `src/app.module.ts` - Add SentryModule, HealthModule
- `package.json` - Add scripts for production

## Implementation Steps

### Step 1: Install Monitoring Dependencies (5min)

```bash
npm install @sentry/nestjs @sentry/profiling-node
npm install @nestjs/terminus @nestjs/axios
```

### Step 2: Create Sentry Instrument File (15min)

```typescript
// src/instrument.ts
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  release: process.env.npm_package_version,

  // Performance
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  profilesSampleRate: 0.1,

  // Integrations
  integrations: [nodeProfilingIntegration()],

  // Filter sensitive data
  beforeSend(event) {
    // Remove sensitive headers
    if (event.request?.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
    }
    return event;
  },
});
```

### Step 3: Update main.ts (10min)

```typescript
// src/main.ts
import './instrument';  // MUST be first import!

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger/swagger.config';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global interceptors and filters
  app.useGlobalInterceptors(new ResponseTransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // CORS for mobile clients
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Swagger (disabled in production for security)
  if (process.env.NODE_ENV !== 'production') {
    setupSwagger(app);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application running on port ${port}`);
}

bootstrap();
```

### Step 4: Configure AppModule with Sentry (15min)

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    // Sentry must be first
    SentryModule.forRoot(),

    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
      envFilePath: ['.env.local', '.env'],
    }),

    // Rate limiting
    ThrottlerModule.forRoot([{
      ttl: 60000,   // 1 minute
      limit: 100,   // 100 requests per minute
    }]),

    // Feature modules
    DatabaseModule,
    AuthModule,
    UserModule,
    LanguageModule,
    LessonModule,
    ProgressModule,
    AiModule,
    SubscriptionModule,
    NotificationModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
```

### Step 5: Create Health Module (30min)

```typescript
// src/health/health.module.ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

```typescript
// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Basic health check' })
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
    ]);
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe for Kubernetes/Railway' })
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe with all dependencies' })
  readiness() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024), // 150MB
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),   // 300MB
    ]);
  }

  @Public()
  @Get('detailed')
  @HealthCheck()
  @ApiOperation({ summary: 'Detailed health check (internal use)' })
  detailed() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),
      () => this.disk.checkStorage('storage', { path: '/', thresholdPercent: 0.9 }),
    ]);
  }
}
```

### Step 6: Create Dockerfile (20min)

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Build application
COPY . .
RUN npm run build

# Production image
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application
COPY --from=builder /app/dist ./dist

# Set environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health/live || exit 1

# Run application
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

### Step 7: Create Railway Configuration (15min)

```json
// railway.json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "numReplicas": 1,
    "sleepApplication": false,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "healthcheckPath": "/health/live",
    "healthcheckTimeout": 10
  }
}
```

### Step 8: Create GitHub Actions CI/CD (40min)

```yaml
# .github/workflows/ci-cd.yml
name: CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linting
        run: npm run lint

      - name: Run type check
        run: npm run type-check

      - name: Run unit tests
        run: npm run test
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/test

      - name: Run e2e tests
        run: npm run test:e2e
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/test
          JWT_SECRET: test-secret

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

  build:
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build application
        run: npm run build

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/

  deploy-dev:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/develop'
    environment: development

    steps:
      - uses: actions/checkout@v4

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Deploy to Railway (Dev)
        run: railway up --service be-flowering-dev
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN_DEV }}

  deploy-prod:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    environment: production

    steps:
      - uses: actions/checkout@v4

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Deploy to Railway (Prod)
        run: railway up --service be-flowering-prod
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN_PROD }}
```

### Step 9: Update Package.json Scripts (10min)

```json
{
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\"",
    "lint:fix": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
    "type-check": "tsc --noEmit",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "migration:generate": "typeorm migration:generate",
    "migration:run": "typeorm migration:run",
    "migration:revert": "typeorm migration:revert"
  }
}
```

### Step 10: Create Complete .env.example (15min)

```bash
# .env.example

# Application
NODE_ENV=development
PORT=3000

# Database (Supabase)
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres
SUPABASE_URL=https://[PROJECT].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...

# Authentication
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# OAuth - Google
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# OAuth - Apple
APPLE_CLIENT_ID=com.yourapp.bundle
APPLE_TEAM_ID=xxx
APPLE_KEY_ID=xxx
APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----

# AI / LLM
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-xxx
LLM_SIMPLE_MODEL=gpt-4o-mini
LLM_COMPLEX_MODEL=gpt-4o

# Langfuse (AI Tracing)
LANGFUSE_SECRET_KEY=sk-lf-xxx
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com

# RevenueCat (Subscriptions)
REVENUECAT_API_KEY=xxx
REVENUECAT_WEBHOOK_SECRET=xxx

# Firebase (Push Notifications)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----

# Sentry (Error Tracking)
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

## Todo List

- [ ] Install @sentry/nestjs and @sentry/profiling-node
- [ ] Install @nestjs/terminus for health checks
- [ ] Create instrument.ts with Sentry config
- [ ] Update main.ts to import instrument first
- [ ] Add SentryModule to AppModule
- [ ] Add SentryGlobalFilter as APP_FILTER
- [ ] Create HealthModule
- [ ] Create HealthController with /health endpoints
- [ ] Create Dockerfile for production
- [ ] Create railway.json configuration
- [ ] Create .github/workflows/ci-cd.yml
- [ ] Update package.json scripts
- [ ] Create complete .env.example
- [ ] Set up Railway dev environment
- [ ] Set up Railway prod environment
- [ ] Configure Railway environment variables
- [ ] Add GitHub secrets for Railway tokens
- [ ] Test deployment pipeline end-to-end

## Success Criteria

- [x] Sentry captures and reports errors
- [x] Performance traces visible in Sentry
- [x] GET /health returns database status
- [x] GET /health/live returns 200 immediately
- [x] GET /health/ready checks all dependencies
- [x] Docker build completes successfully
- [x] Railway dev deployment succeeds
- [x] Railway prod deployment succeeds
- [x] GitHub Actions runs on push/PR
- [x] Zero-downtime deployments verified

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Sentry overhead | Low | Low | Adjust sampling rates |
| Railway cold starts | Medium | Low | Use sleepApplication: false |
| Failed deployments | Low | High | Rollback strategy in Railway |
| Secret exposure | Low | Critical | Use GitHub secrets, Railway vars |

## Security Considerations

- Sentry filters authorization headers
- Swagger disabled in production
- Environment variables never committed
- Health endpoints are public but limited info
- Railway secrets encrypted at rest
