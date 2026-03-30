# Code Standards

**Last Updated:** 2026-03-28

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
│   ├── entities/             # TypeORM entities (14 total)
│   ├── migrations/           # Database migrations (9 total, timestamped)
│   ├── database.module.ts    # TypeORM module configuration (14 entities registered)
│   └── supabase-storage.service.ts   # Supabase Storage wrapper
└── modules/                   # Feature modules (domain-driven)
    ├── auth/                 # Authentication & authorization
    ├── user/                 # User management
    ├── language/             # Language preferences & proficiency
    ├── ai/                   # AI-powered learning features
    ├── onboarding/           # Anonymous onboarding chat
    ├── subscription/         # RevenueCat subscriptions
    ├── notification/         # Firebase push notifications
    └── email/                # Nodemailer SMTP service
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

### Type Safety

Always use explicit types:
```typescript
// Good
async getUserSubscription(userId: string): Promise<SubscriptionDto | null> {
  const subscription = await this.repository.findOne({ where: { userId } });
  return subscription ? this.mapToDto(subscription) : null;
}

// Avoid
async getUserSubscription(userId) {
  const subscription = await this.repository.findOne({ where: { userId } });
  return subscription ? this.mapToDto(subscription) : null;
}
```

### Async/Await

Use async/await over promises:
```typescript
// Good
async function processWebhook(payload: RevenueCatWebhookDto): Promise<void> {
  try {
    const user = await this.findUser(payload.event.app_user_id);
    await this.updateSubscription(user.id, payload);
  } catch (error) {
    this.logger.error('Webhook processing failed', error.stack);
    throw error;
  }
}
```

### Error Handling

Use NestJS built-in exceptions:
```typescript
async findOne(id: string): Promise<Entity> {
  const entity = await this.repository.findOne({ where: { id } });
  if (!entity) {
    throw new NotFoundException(`Entity with ID ${id} not found`);
  }
  return entity;
}
```

### Dependency Injection

Use constructor injection:
```typescript
@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    private readonly configService: ConfigService,
  ) {}
}
```

## Data Transfer Objects (DTOs)

### DTO Structure

```typescript
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  name?: string;
}
```

### Validation Decorators

Use `class-validator` for input validation:
```typescript
import {
  IsString,
  IsEmail,
  IsEnum,
  IsUUID,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  @IsString()
  @IsOptional()
  deviceName?: string;
}
```

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

### Public Routes

```typescript
@Public()
@Post('webhook')
async handleWebhook() {
  // No authentication required
}
```

### Protected Routes (Default)

```typescript
@Get('me')
async getProfile(@CurrentUser() user: User) {
  // Requires JWT authentication
}
```

### Current User Decorator

```typescript
async updateProfile(@CurrentUser() user: User, @Body() dto: UpdateDto) {
  return this.service.update(user.id, dto);
}
```

## Configuration Management

### Environment Variables

Define all config in `app-configuration.ts`:

```typescript
export interface AppConfiguration {
  revenuecat: {
    apiKey?: string;
    webhookSecret?: string;
  };
  firebase: {
    projectId?: string;
    clientEmail?: string;
    privateKey?: string;
  };
}

export default (): AppConfiguration => ({
  revenuecat: {
    apiKey: process.env.REVENUECAT_API_KEY,
    webhookSecret: process.env.REVENUECAT_WEBHOOK_SECRET,
  },
});
```

### Accessing Config

```typescript
constructor(private readonly configService: ConfigService) {}

const apiKey = this.configService.get<string>('revenuecat.apiKey');
```

## Logging

### Logger Usage

```typescript
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  async processWebhook(payload: RevenueCatWebhookDto): Promise<void> {
    this.logger.log(`Processing webhook: ${payload.event.type}`);
    try {
      await this.updateSubscription(payload);
    } catch (error) {
      this.logger.error(`Webhook error: ${error.message}`, error.stack);
    }
  }
}
```

### Log Levels

- `logger.log()` - General information
- `logger.warn()` - Warning messages
- `logger.error()` - Error messages with stack trace
- `logger.debug()` - Debug information (development only)
- `logger.verbose()` - Detailed logs (development only)

## Swagger/OpenAPI Documentation

### Controller Documentation

```typescript
@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionController {
  @Get('me')
  @ApiOperation({ summary: 'Get current user subscription' })
  @ApiResponse({ status: 200, description: 'Subscription found', type: SubscriptionDto })
  async getSubscription(@CurrentUser() user: User): Promise<SubscriptionDto | null> {
    return this.service.getUserSubscription(user.id);
  }
}
```

### Exclude from Swagger

```typescript
@Public()
@Post('revenuecat')
@ApiExcludeEndpoint()  // Hide from Swagger docs
async handleWebhook(@Body() payload: RevenueCatWebhookDto) {
  // Webhook endpoint
}
```

## Testing Standards

### Unit Test Structure

```typescript
describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let repository: MockRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        {
          provide: getRepositoryToken(Subscription),
          useValue: createMockRepository(),
        },
      ],
    }).compile();
    service = module.get<SubscriptionService>(SubscriptionService);
  });

  it('should return subscription for valid user', async () => {
    const userId = 'user-id';
    const subscription = { id: 'sub-id', userId, plan: 'monthly' };
    repository.findOne.mockResolvedValue(subscription);

    const result = await service.getUserSubscription(userId);
    expect(result).toEqual(subscription);
  });
});
```

## Security Best Practices

### Webhook Security

```typescript
import { timingSafeEqual } from 'crypto';

private verifyAuth(authHeader: string, expectedSecret: string): boolean {
  const expected = `Bearer ${expectedSecret}`;
  if (!authHeader || authHeader.length !== expected.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}
```

### Password Hashing

```typescript
import * as bcrypt from 'bcrypt';

async hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async validatePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

### Environment Variables

- Never commit `.env` files to git
- Use `.env.example` for documentation
- Validate all required variables on startup
- Use optional typing for truly optional variables

## Code Quality

### ESLint Rules

Follow the project's ESLint configuration. Key rules:
- No unused variables
- Prefer `const` over `let`
- Require explicit return types on functions
- Enforce consistent spacing and formatting

### Prettier Formatting

Run `npm run format` before committing.

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

### Database Queries

Avoid N+1 queries - use relations:
```typescript
// Good
const subscriptions = await this.repository.find({
  where: { userId },
  relations: ['user'],
});

// Avoid N+1
const subscriptions = await this.repository.find({ where: { userId } });
for (const sub of subscriptions) {
  sub.user = await this.userRepository.findOne({ where: { id: sub.userId } });
}
```

### Async Processing

Use `setImmediate()` for non-blocking webhooks:
```typescript
@Post('webhook')
async handleWebhook(@Body() payload: WebhookDto): Promise<{ status: string }> {
  setImmediate(() => {
    this.processWebhook(payload).catch((err) => {
      this.logger.error('Webhook processing failed', err.stack);
    });
  });
  return { status: 'received' };
}
```

## File Size Guidelines

- Keep files under 200 lines when possible
- Split large services into multiple smaller services
- Extract complex logic into separate utility functions
- Use composition over large inheritance hierarchies

## Comments and Documentation

### JSDoc Comments

```typescript
/**
 * Processes RevenueCat webhook events to update subscription status
 * @param payload - RevenueCat webhook payload
 * @throws {NotFoundException} If user not found
 * @returns Promise resolving when processing complete
 */
async processWebhook(payload: RevenueCatWebhookDto): Promise<void> {
  // Implementation
}
```

### Inline Comments

Use inline comments for complex logic:

```typescript
// Timing-safe comparison to prevent timing attacks
if (!timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))) {
  throw new UnauthorizedException();
}
```

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

## Deprecated Patterns

### Avoid These Patterns

Don't use `any` type - always type explicitly:
```typescript
// Avoid: function processData(data: any) {}
// Use:
function processData(data: WebhookPayload) {}
```

Don't use `var` - use `const`:
```typescript
// Avoid: var userId = user.id;
// Use:
const userId = user.id;
```

Don't ignore errors - always handle them:
```typescript
// Avoid: try { await this.process(); } catch {}
// Use:
try {
  await this.process();
} catch (error) {
  this.logger.error('Processing failed', error.stack);
  throw error;
}
```
