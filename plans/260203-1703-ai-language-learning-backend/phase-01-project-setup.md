# Phase 01: Project Setup & Configuration

## Overview

| Field | Value |
|-------|-------|
| Priority | P1 - Critical Path |
| Status | completed |
| Effort | 4h |
| Dependencies | None |

Initialize NestJS 11 project with TypeScript strict mode, configure tooling (ESLint, Prettier, Jest), environment management, Swagger/OpenAPI, and standard response format.

## Key Insights

From research reports:
- NestJS 11 supports modular architecture ideal for AI integrations
- Swagger decorators enable auto-generated API documentation
- Response transform interceptor + exception filter = consistent API responses

## Requirements

### Functional
- NestJS 11 project with TypeScript strict mode
- ESLint + Prettier configured
- Jest testing framework ready
- Environment configuration with validation
- Swagger UI at `/api/docs`
- Standard response format: `{ code: 1, message: "Success", data: {...} }`

### Non-Functional
- TypeScript strict mode enabled
- No `any` types allowed
- Consistent code style across project

## Architecture

```
src/
├── main.ts                    # Bootstrap with Swagger
├── app.module.ts              # Root module
├── config/
│   ├── configuration.ts       # Config factory
│   └── validation.schema.ts   # Joi validation
├── common/
│   ├── decorators/
│   │   └── public.decorator.ts
│   ├── dto/
│   │   └── base-response.dto.ts
│   ├── filters/
│   │   └── all-exceptions.filter.ts
│   └── interceptors/
│       └── response-transform.interceptor.ts
└── swagger/
    └── swagger.config.ts
```

## Related Code Files

### Files to Create
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript strict config
- `.eslintrc.js` - ESLint rules
- `.prettierrc` - Prettier config
- `nest-cli.json` - NestJS CLI config
- `.env.example` - Environment template
- `src/main.ts` - Application bootstrap
- `src/app.module.ts` - Root module
- `src/config/configuration.ts` - Config factory
- `src/config/validation.schema.ts` - Joi schema
- `src/common/dto/base-response.dto.ts` - Response DTO
- `src/common/filters/all-exceptions.filter.ts` - Global exception filter
- `src/common/interceptors/response-transform.interceptor.ts` - Response interceptor
- `src/common/decorators/public.decorator.ts` - Public route decorator
- `src/swagger/swagger.config.ts` - Swagger setup

## Implementation Steps

### Step 1: Initialize NestJS Project (30min)

```bash
# Create new NestJS project
npx @nestjs/cli new be_flowering --package-manager npm --strict

# Or if starting fresh in existing folder
npm init -y
npm install @nestjs/common@^11 @nestjs/core@^11 @nestjs/platform-express@^11
npm install reflect-metadata rxjs
```

### Step 2: Configure TypeScript Strict Mode (15min)

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictPropertyInitialization": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

### Step 3: Install Core Dependencies (15min)

```bash
npm install @nestjs/config @nestjs/swagger class-validator class-transformer joi
npm install -D @types/node typescript eslint prettier
npm install -D @nestjs/testing jest @types/jest ts-jest
```

### Step 4: Configure ESLint + Prettier (20min)

ESLint config with TypeScript support, Prettier integration.

### Step 5: Setup Environment Configuration (30min)

Create config module with Joi validation for required environment variables.

```typescript
// src/config/validation.schema.ts
import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  // ... more variables
});
```

### Step 6: Implement Response Transform Interceptor (30min)

```typescript
// src/common/interceptors/response-transform.interceptor.ts
@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<T, BaseResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<BaseResponse<T>> {
    return next.handle().pipe(
      map(data => ({
        code: 1,
        message: 'Success',
        data,
      })),
    );
  }
}
```

### Step 7: Implement Global Exception Filter (30min)

```typescript
// src/common/filters/all-exceptions.filter.ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // Return { code: 0, message: '...', data: null }
  }
}
```

### Step 8: Configure Swagger/OpenAPI (30min)

```typescript
// src/swagger/swagger.config.ts
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('AI Language Learning API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
}
```

### Step 9: Bootstrap Application (20min)

```typescript
// src/main.ts
import { setupSwagger } from './swagger/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.useGlobalInterceptors(new ResponseTransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  setupSwagger(app);

  await app.listen(process.env.PORT || 3000);
}
```

### Step 10: Initialize Git Repository (10min)

```bash
git init
# Create .gitignore with node_modules, dist, .env, etc.
git add .
git commit -m "chore: initialize nestjs project with typescript strict mode"
```

## Todo List

- [x] Initialize NestJS 11 project
- [x] Configure TypeScript strict mode
- [x] Install all dependencies
- [x] Setup ESLint configuration
- [x] Setup Prettier configuration
- [x] Create environment configuration with validation
- [x] Create .env.example template
- [x] Implement BaseResponse DTO
- [x] Implement ResponseTransformInterceptor
- [x] Implement AllExceptionsFilter
- [x] Create Public decorator
- [x] Configure Swagger/OpenAPI
- [x] Update main.ts with all global configs
- [x] Initialize git repository
- [x] Verify build compiles without errors
- [x] Run initial tests pass (no tests created yet)

## Success Criteria

- [x] `npm run build` completes without errors
- [x] `npm run start:dev` starts server on configured port
- [x] `GET /api/docs` shows Swagger UI
- [x] API responses follow format `{ code, message, data }`
- [x] Environment validation fails on missing required vars
- [x] ESLint + Prettier run without errors

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| NestJS 11 breaking changes | Low | Medium | Use stable @nestjs versions |
| TypeScript strict too restrictive | Low | Low | Can relax specific rules if needed |

## Security Considerations

- No secrets in committed code
- .env files in .gitignore
- Environment validation prevents startup without required secrets
