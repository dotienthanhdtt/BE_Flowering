w# Code Standards

**Last Updated:** 2026-05-11

## Project Structure

```
src/
├── app.module.ts              # Root application module
├── main.ts                    # Application entry point & bootstrap
├── common/                    # Shared utilities and cross-cutting concerns
│   ├── decorators/           # Custom decorators (@Public, @CurrentUser)
│   ├── filters/              # Exception filters
│   ├── guards/               # Auth guards (JWT, OptionalJWT)
│   └── interceptors/         # Response interceptors, logging
├── config/                    # Application configuration
│   ├── app-configuration.ts  # Config interface & factory
│   └── environment-validation-schema.ts  # Joi validation
├── database/                  # Database layer
│   ├── entities/             # TypeORM entities (21 total + 5 enums)
│   ├── migrations/           # Database migrations (37 total, timestamped)
│   ├── database.module.ts    # TypeORM module configuration (21 entities registered)
│   └── object-storage.service.ts     # AWS S3-compatible storage wrapper
└── modules/                   # Feature modules (domain-driven) — 13 total
    ├── admin-content/        # Admin content generation & lifecycle
    ├── ai/                   # AI-powered learning features (LangChain, STT, Langfuse)
    ├── auth/                 # Authentication & authorization (Firebase, JWT, email disabled)
    ├── email/                # Nodemailer SMTP service with graceful init
    ├── kol-bundle/           # KOL bundle creation & gift codes
    ├── language/             # Language preferences, proficiency levels (CEFR/JLPT/HSK/TOPIK)
    ├── lesson/               # Lesson catalog with scenario grouping & auto-enroll
    ├── onboarding/           # Anonymous session chat, resume support
    ├── progress/             # Progress tracking service (internal)
    ├── scenario/             # Scenario chat (2 controllers: listing + chat conversation)
    ├── subscription/         # RevenueCat webhooks & subscription management
    ├── user/                 # User profile management
    └── vocabulary/           # Vocabulary CRUD + Leitner SRS review
```

## API JSON Key Convention

**All JSON keys in HTTP requests and responses use `snake_case`** — both request body params and response data fields.

```json
// Request body
{ "first_name": "John", "target_language": "vi" }

// Response data
{ "user_id": "abc", "created_at": "2026-03-28T..." }
```

- DTOs define properties in `camelCase` (TypeScript convention) with `@Transform` or `@Expose` decorators as needed
- Database column names also use `snake_case` (TypeORM `name` option)
- Internal TypeScript code stays `camelCase`; only the HTTP wire format is `snake_case`

### Snake_case Exception: Scenario Chat Endpoints

`POST /scenario/chat`, `GET /scenario/conversations/:id`, and `GET /scenario/:scenarioId/conversations` are intentionally designed to emit snake_case keys in response payloads (`conversation_id`, `max_turns`, `turn`, `created_at`, etc.). All other endpoints use the standard camelCase response transformation.

## Naming Conventions

### Files and Directories

**TypeScript Files:** Use kebab-case with descriptive suffixes
```
user.controller.ts
auth.service.ts
subscription.entity.ts
create-user.dto.ts
jwt-auth.guard.ts
```

**Test Files:** Match source file name with `.spec.ts` suffix
```
auth.service.spec.ts
subscription.controller.spec.ts
```

**Directories:** Use kebab-case, plural for collections
```
modules/
entities/
migrations/
```

### TypeScript Code

**Classes:** PascalCase
```typescript
export class UserController {}
export class AuthService {}
export class CreateUserDto {}
```

**Interfaces:** PascalCase (prefix with `I` only when collision)
```typescript
export interface AppConfiguration {}
export interface IRevenueCatWebhook {}  // When collision with class
```

**Enums:** PascalCase name, SCREAMING_SNAKE_CASE values
```typescript
export enum SubscriptionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  TRIAL = 'trial',
}
```

**Constants:** SCREAMING_SNAKE_CASE
```typescript
const JWT_EXPIRES_IN = '7d';
const MAX_RETRY_ATTEMPTS = 3;
```

**Variables/Functions:** camelCase
```typescript
const userId = user.id;
async function getUserSubscription(userId: string) {}
```

**Private Members:** camelCase (optional underscore prefix)
```typescript
private readonly logger = new Logger(ClassName.name);
private configService: ConfigService;
```

## Module Structure

### Standard Module Pattern

```typescript
// module-name.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([ModuleEntity])],
  controllers: [ModuleController],
  providers: [ModuleService],
  exports: [ModuleService],
})
export class ModuleModule {}
```

### Controller Pattern

```typescript
@ApiTags('module-name')
@ApiBearerAuth()
@Controller('module-name')
export class ModuleController {
  constructor(private readonly service: ModuleService) {}

  @Get()
  @ApiOperation({ summary: 'Get all items' })
  async findAll(@CurrentUser() user: User) {
    return this.service.findAll(user.id);
  }
}
```

### Service Pattern

```typescript
@Injectable()
export class ModuleService {
  private readonly logger = new Logger(ModuleService.name);

  constructor(
    @InjectRepository(ModuleEntity)
    private readonly repository: Repository<ModuleEntity>,
  ) {}

  async findAll(userId: string): Promise<ModuleEntity[]> {
    this.logger.log(`Finding all items for user ${userId}`);
    return this.repository.find({ where: { userId } });
  }
}
```

## TypeScript Patterns

### Type Safety, Async, Errors, DI
Always use explicit types. Use async/await. Use NestJS exceptions (NotFoundException, etc). Use constructor injection with @InjectRepository and @Injectable.

## Data Transfer Objects (DTOs)

### DTOs & Validation
Use `class-validator` decorators (@IsEmail, @IsString, @IsEnum, @IsOptional, etc) and `@nestjs/swagger` (@ApiProperty, @ApiPropertyOptional) for documentation and validation.

## Database Entities

### Entity Pattern

```typescript
@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'uuid', name: 'user_id', unique: true })
  userId!: string;

  @Column({ type: 'enum', enum: SubscriptionPlan, default: SubscriptionPlan.FREE })
  plan!: SubscriptionPlan;

  @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.ACTIVE })
  status!: SubscriptionStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

### Entity Best Practices

- Use `!` (non-null assertion) for required fields
- Use `?` for optional/nullable fields
- Use `snake_case` for column names
- Use `PascalCase` for entity class names
- Use `camelCase` for property names
- Use `timestamptz` for all timestamps (timezone-aware)
- Use `uuid` for all primary keys
- Use `@CreateDateColumn` and `@UpdateDateColumn` for audit fields
- Use `onDelete: 'CASCADE'` for foreign keys when appropriate

## Authentication & Authorization

### Auth Decorators
Use `@Public()` to bypass JWT (default is protected). Use `@CurrentUser()` to inject authenticated user into method params.

## Configuration Management

### Environment Config
Define all config in `app-configuration.ts` with proper types. Access via `this.configService.get<T>('path.to.key')`. Never commit `.env` to git; use `.env.example` for documentation.

## Logging

### Logging
Create logger: `private readonly logger = new Logger(ClassName.name);` Log levels: log (info) / warn / error (with stack) / debug / verbose.

## Swagger/OpenAPI Documentation

### Swagger Documentation
Use @ApiTags, @ApiBearerAuth, @ApiOperation, @ApiResponse for docs. Use @ApiExcludeEndpoint() to hide webhooks/internal endpoints.

## Testing Standards

### Unit Tests
Use Test.createTestingModule to mock dependencies with getRepositoryToken. Mock repositories with resolved values. Test both success and error paths.

## Security Best Practices

### Security
**Webhooks:** Use timingSafeEqual for Bearer token comparison. **Password:** Use bcrypt.genSalt + bcrypt.hash for hashing; bcrypt.compare for validation. **Env:** Never commit .env; validate on startup.

### Environment Variables

- Never commit `.env` files to git
- Use `.env.example` for documentation
- Validate all required variables on startup
- Use optional typing for truly optional variables

## External Service Integration Patterns

### Graceful Degradation
For non-critical external services (Firebase, SMTP), wrap onModuleInit in try-catch. Use `initialized` flag; endpoints return 503 if unavailable instead of crashing the app.

### Signed URLs (Private Files)
Use AWS SDK S3 `GetObjectCommand` with SigV4 presigner. For audio/transcription: save to private Railway bucket, return signed URL (1h expiry) to mobile. ObjectStorageService encapsulates this; call `getSignedUrl(key, expirySeconds)` before returning to client.

### Rate Limiting
Use @Throttle decorator with limit/ttl. AI endpoints: 20/min or 100/hr. Onboarding: 5/hr (create) / 30/hr (chat). Admin: 5/min. Custom guards for IP-based (onboarding) vs user-based (AI).

## Code Quality

### Linting & Formatting
Run `npm run lint` and `npm run format` before committing. Key rules: no unused vars, prefer const, explicit return types.

### Import Organization

```typescript
// 1. NestJS imports
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

// 2. Third-party imports
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';

// 3. Local imports (absolute paths)
import { Subscription } from '../../database/entities/subscription.entity';
import { SubscriptionDto } from './dto/subscription.dto';
```

## Performance Considerations

### Performance
Avoid N+1 queries: use relations in find options. For webhooks: respond immediately with setImmediate() for async processing; catch and log errors.

## File Size Guidelines

- Keep files under 200 lines when possible
- Split large services into multiple smaller services
- Extract complex logic into separate utility functions
- Use composition over large inheritance hierarchies

## Comments and Documentation

### Comments
Use JSDoc for complex public methods. Use inline comments for security-critical logic (e.g., timing-safe comparison, race conditions).

## Version Control

### Commit Messages

Follow Conventional Commits format:

```
feat(subscription): add RevenueCat webhook handler
fix(notification): resolve device token duplicate error
docs(readme): update environment variable section
refactor(auth): extract JWT validation to separate method
test(subscription): add webhook processing tests
```

### Branch Naming

```
feature/subscription-module
bugfix/device-token-validation
hotfix/webhook-auth-timing
refactor/ai-client-factory
```

## AI Module Patterns

### Langfuse Tracing Pattern

Per-invocation handler with explicit flush for all 3 LLM providers:

```typescript
@Injectable()
export class OpenaiLLMProvider {
  async chat(prompt: string): Promise<string> {
    const handler = this.langfuseService.getHandler(); // Fresh handler per invocation

    try {
      const model = this.modelFactory.create({
        callbacks: [handler], // Pass handler to model
      });
      const response = await model.invoke(prompt);
      return response;
    } finally {
      await handler.flushAsync(); // Ensure traces sent before returning
    }
  }
}
```

**Key Points:**
- Create new CallbackHandler per request (not shared instance)
- Pass same handler to createModel() for consistent tracing
- Always flush in finally block to ensure trace delivery
- Applies to OpenAI, Anthropic, and Gemini providers

### Optional Premium Pattern

Use `@RequirePremium(false)` decorator for endpoints that are public but optionally premium:

```typescript
@Post('translate')
@Public()
@RequirePremium(false)
async translateWord(
  @CurrentUser() user?: User,
  @Body() dto: TranslateRequestDto,
) {
  // Process request (works for authenticated with optional premium, or anonymous)
}
```

Decorator implementation:

```typescript
export function RequirePremium(required = true): MethodDecorator {
  return (target: any, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata('require_premium', required, descriptor!.value);
    return descriptor;
  };
}
```

Guard checks decorator metadata and skips premium check if false.

### Prompt Management

Store prompts as markdown files in `src/modules/ai/prompts/`:

**File:** `correction-check-prompt.md`
```markdown
# Grammar Correction Check

Context: Previous AI message
User message: {userMessage}
Target language: {targetLanguage}

Respond with corrected text or null if no errors.
Ignore punctuation and capitalization differences.
Bold only grammar fixes and language replacements (e.g., **went** for **go**).
Handle gibberish/emoji-only input: return null.
```

Load and render:

```typescript
async checkCorrection(dto: CorrectionCheckRequestDto): Promise<string | null> {
  const prompt = await this.promptLoader.load('correction-check-prompt.json');
  const rendered = prompt
    .replace('{userMessage}', dto.userMessage)
    .replace('{targetLanguage}', dto.targetLanguage);

  return this.llmService.callLLM(rendered, 'GPT_4_1_NANO');
}
```

## Third-Party Webhook Integration Patterns

### RevenueCat Webhook Validation

**Pattern:** Controller-local ValidationPipe override for third-party webhooks.

**Rationale:** Global `ValidationPipe` uses `forbidNonWhitelisted: true` to catch unexpected request properties. Third-party providers (e.g., RevenueCat) periodically add optional fields to webhook payloads. A global strict pipe would reject these payloads prematurely.

**Implementation:**

```typescript
@Controller('webhooks')
export class WebhookController {
  constructor(private service: WebhookService) {}

  @Post('revenuecat')
  @UsePipes(
    new ValidationPipe({
      forbidNonWhitelisted: false,  // Allow unknown RC fields
      transform: true,              // Still transform DTOs
    }),
  )
  async handleRevenueCat(@Body() dto: RevenueCatWebhookDto) {
    // Process webhook
  }
}
```

**Key Points:**
- Local pipe overrides global for this endpoint only
- Still transforms incoming JSON to DTO (camelCase)
- Ignores unknown properties from RC instead of rejecting
- DTOs remain strict on their known fields (validation still applied)
- All other endpoints continue using global strict validation

## Deprecated Patterns

**Avoid:** `any` type, `var` keyword, empty catch blocks. **Always:** Type explicitly, use `const`, handle and log errors.
