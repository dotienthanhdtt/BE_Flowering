# Code Standards

**Last Updated:** 2026-02-04

## Project Structure

### Directory Organization

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
│   ├── entities/             # TypeORM entities
│   ├── migrations/           # Database migrations (timestamped)
│   ├── database.module.ts    # TypeORM module configuration
│   └── supabase.service.ts   # Supabase client wrapper
└── modules/                   # Feature modules (domain-driven)
    ├── auth/                 # Authentication & authorization
    ├── user/                 # User management
    ├── ai/                   # AI learning features
    ├── subscription/         # RevenueCat subscriptions
    │   ├── dto/             # Data transfer objects
    │   ├── webhooks/        # Webhook controllers
    │   ├── subscription.controller.ts
    │   ├── subscription.service.ts
    │   └── subscription.module.ts
    └── notification/         # Push notifications
        ├── dto/
        ├── notification.controller.ts
        ├── notification.service.ts
        ├── firebase.service.ts
        └── notification.module.ts
```

## Naming Conventions

### Files and Directories

**TypeScript Files:** Use kebab-case with descriptive suffixes
```
user.controller.ts
user.service.ts
user.entity.ts
user.module.ts
create-user.dto.ts
jwt-auth.guard.ts
current-user.decorator.ts
```

**Scripts (Non-Docs):** Use kebab-case with long descriptive names
```
generate-migration-from-entities.ts
seed-database-with-test-users.ts
validate-environment-variables.ts
```

**Test Files:** Match source file name with `.spec.ts` suffix
```
user.service.spec.ts
auth.controller.spec.ts
subscription.service.spec.ts
```

**Directories:** Use kebab-case, singular for utilities, plural for collections
```
common/
modules/
entities/
migrations/
```

### TypeScript Code

**Classes:** PascalCase with descriptive suffixes
```typescript
export class UserController {}
export class AuthService {}
export class SubscriptionEntity {}
export class CreateUserDto {}
export class JwtAuthGuard {}
```

**Interfaces:** PascalCase, prefix with `I` only when needed for clarity
```typescript
export interface AppConfiguration {}
export interface AIClient {}
export interface IRevenueCatWebhook {}  // When collision with class
```

**Enums:** PascalCase for enum name, SCREAMING_SNAKE_CASE for values
```typescript
export enum SubscriptionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  TRIAL = 'trial',
}

export enum SubscriptionPlan {
  FREE = 'free',
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
  LIFETIME = 'lifetime',
}
```

**Constants:** SCREAMING_SNAKE_CASE
```typescript
const JWT_EXPIRES_IN = '7d';
const MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_PAGE_SIZE = 20;
```

**Variables and Functions:** camelCase
```typescript
const userId = user.id;
const isActive = subscription.status === 'active';

function getUserSubscription(userId: string) {}
async function processWebhook(payload: RevenueCatWebhookDto) {}
```

**Private Class Members:** camelCase with underscore prefix (optional)
```typescript
private readonly logger = new Logger(ClassName.name);
private configService: ConfigService;
```

## Module Structure

### Standard Module Pattern

Each feature module follows this structure:

```typescript
// module-name.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModuleNameController } from './module-name.controller';
import { ModuleNameService } from './module-name.service';
import { ModuleNameEntity } from '../../database/entities/module-name.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ModuleNameEntity])],
  controllers: [ModuleNameController],
  providers: [ModuleNameService],
  exports: [ModuleNameService], // Export if used by other modules
})
export class ModuleNameModule {}
```

### Controller Pattern

```typescript
// module-name.controller.ts
import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ModuleNameService } from './module-name.service';
import { CreateDto } from './dto/create.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';

/**
 * Controller for module-name endpoints
 */
@ApiTags('module-name')
@ApiBearerAuth()
@Controller('module-name')
export class ModuleNameController {
  constructor(private readonly service: ModuleNameService) {}

  @Get()
  @ApiOperation({ summary: 'Get all items' })
  async findAll(@CurrentUser() user: User) {
    return this.service.findAll(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create item' })
  async create(@CurrentUser() user: User, @Body() dto: CreateDto) {
    return this.service.create(user.id, dto);
  }
}
```

### Service Pattern

```typescript
// module-name.service.ts
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModuleNameEntity } from '../../database/entities/module-name.entity';
import { CreateDto } from './dto/create.dto';

/**
 * Service handling business logic for module-name
 */
@Injectable()
export class ModuleNameService {
  private readonly logger = new Logger(ModuleNameService.name);

  constructor(
    @InjectRepository(ModuleNameEntity)
    private readonly repository: Repository<ModuleNameEntity>,
  ) {}

  async findAll(userId: string): Promise<ModuleNameEntity[]> {
    this.logger.log(`Finding all items for user ${userId}`);
    return this.repository.find({ where: { userId } });
  }

  async create(userId: string, dto: CreateDto): Promise<ModuleNameEntity> {
    this.logger.log(`Creating item for user ${userId}`);
    const entity = this.repository.create({ ...dto, userId });
    return this.repository.save(entity);
  }
}
```

## TypeScript Patterns

### Type Safety

**Always use explicit types for function parameters and return values:**
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

**Use interfaces for complex object shapes:**
```typescript
interface WebhookEvent {
  type: string;
  app_user_id: string;
  product_id: string;
  timestamp: number;
}

interface AppConfiguration {
  port: number;
  database: {
    url: string;
    supabaseUrl: string;
  };
}
```

**Use enums for fixed sets of values:**
```typescript
export enum DevicePlatform {
  IOS = 'ios',
  ANDROID = 'android',
  WEB = 'web',
}
```

### Async/Await

**Always use async/await over promises:**
```typescript
// Good
async function processWebhook(payload: RevenueCatWebhookDto): Promise<void> {
  try {
    const user = await this.findUser(payload.event.app_user_id);
    await this.updateSubscription(user.id, payload);
    this.logger.log('Webhook processed successfully');
  } catch (error) {
    this.logger.error('Webhook processing failed', error.stack);
    throw error;
  }
}

// Avoid
function processWebhook(payload: RevenueCatWebhookDto): Promise<void> {
  return this.findUser(payload.event.app_user_id)
    .then(user => this.updateSubscription(user.id, payload))
    .then(() => this.logger.log('Webhook processed successfully'))
    .catch(error => {
      this.logger.error('Webhook processing failed', error.stack);
      throw error;
    });
}
```

### Error Handling

**Use NestJS built-in exceptions:**
```typescript
import {
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

async findOne(id: string): Promise<Entity> {
  const entity = await this.repository.findOne({ where: { id } });
  if (!entity) {
    throw new NotFoundException(`Entity with ID ${id} not found`);
  }
  return entity;
}

async validateWebhook(authHeader: string): Promise<void> {
  if (!this.verifyAuth(authHeader)) {
    throw new UnauthorizedException('Invalid webhook authorization');
  }
}
```

**Use try-catch for expected errors:**
```typescript
async processWebhook(payload: RevenueCatWebhookDto): Promise<void> {
  try {
    await this.updateSubscription(payload);
  } catch (error) {
    this.logger.error(`Webhook processing error: ${error.message}`, error.stack);
    // Don't rethrow - webhook already responded with 200
  }
}
```

### Dependency Injection

**Use constructor injection:**
```typescript
@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {}
}
```

**Use `@Inject()` for custom providers:**
```typescript
constructor(
  @Inject('AI_CLIENT_FACTORY')
  private readonly aiClientFactory: AIClientFactory,
) {}
```

## Data Transfer Objects (DTOs)

### DTO Structure

```typescript
// create-user.dto.ts
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

Use `class-validator` decorators for input validation:

```typescript
import {
  IsString,
  IsEmail,
  IsEnum,
  IsUUID,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
  Max,
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

### Response DTOs

```typescript
export class SubscriptionDto {
  id!: string;
  plan!: SubscriptionPlan;
  status!: SubscriptionStatus;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd!: boolean;
}
```

## Database Entities

### Entity Pattern

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

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

  @Column({ type: 'varchar', length: 255, name: 'revenuecat_id', nullable: true })
  revenuecatId?: string;

  @Column({ type: 'timestamptz', name: 'current_period_start', nullable: true })
  currentPeriodStart?: Date;

  @Column({ type: 'timestamptz', name: 'current_period_end', nullable: true })
  currentPeriodEnd?: Date;

  @Column({ type: 'boolean', name: 'cancel_at_period_end', default: false })
  cancelAtPeriodEnd!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

### Entity Best Practices

- Use `!` (non-null assertion) for required fields
- Use `?` for optional/nullable fields
- Use `snake_case` for column names (`name: 'user_id'`)
- Use `PascalCase` for entity class names
- Use `camelCase` for property names
- Use `timestamptz` for all timestamps (timezone-aware)
- Use `uuid` for all primary keys
- Use `@CreateDateColumn` and `@UpdateDateColumn` for audit fields
- Use `onDelete: 'CASCADE'` for foreign keys when appropriate

## Authentication & Authorization

### Public Routes

```typescript
import { Public } from '../../../common/decorators/public-route.decorator';

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

### Optional Authentication

```typescript
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

@UseGuards(OptionalJwtAuthGuard)
@Get('public-data')
async getPublicData(@CurrentUser() user?: User) {
  // Works with or without authentication
}
```

### Current User Decorator

```typescript
import { CurrentUser } from '../auth/decorators/current-user.decorator';

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
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  },
});
```

### Validation Schema

Validate in `environment-validation-schema.ts`:

```typescript
import * as Joi from 'joi';

export const environmentValidationSchema = Joi.object({
  REVENUECAT_API_KEY: Joi.string().optional(),
  REVENUECAT_WEBHOOK_SECRET: Joi.string().optional(),
  FIREBASE_PROJECT_ID: Joi.string().optional(),
  FIREBASE_CLIENT_EMAIL: Joi.string().optional(),
  FIREBASE_PRIVATE_KEY: Joi.string().optional(),
});
```

### Accessing Config

```typescript
constructor(private readonly configService: ConfigService) {}

const apiKey = this.configService.get<string>('revenuecat.apiKey');
const webhookSecret = this.configService.get<string>('revenuecat.webhookSecret');
```

## Logging

### Logger Usage

```typescript
import { Logger } from '@nestjs/common';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  async processWebhook(payload: RevenueCatWebhookDto): Promise<void> {
    this.logger.log(`Processing webhook: ${payload.event.type}`);

    try {
      await this.updateSubscription(payload);
      this.logger.log('Webhook processed successfully');
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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionController {
  @Get('me')
  @ApiOperation({ summary: 'Get current user subscription' })
  @ApiResponse({ status: 200, description: 'Subscription found', type: SubscriptionDto })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async getSubscription(@CurrentUser() user: User): Promise<SubscriptionDto | null> {
    return this.service.getUserSubscription(user.id);
  }
}
```

### DTO Documentation

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDeviceDto {
  @ApiProperty({ example: 'firebase-fcm-token-here', description: 'FCM device token' })
  token!: string;

  @ApiProperty({ enum: DevicePlatform, example: DevicePlatform.IOS })
  platform!: DevicePlatform;

  @ApiPropertyOptional({ example: 'iPhone 15 Pro' })
  deviceName?: string;
}
```

### Exclude from Swagger

```typescript
import { ApiExcludeEndpoint } from '@nestjs/swagger';

@Public()
@Post('revenuecat')
@ApiExcludeEndpoint() // Hide from Swagger docs
async handleWebhook(@Body() payload: RevenueCatWebhookDto) {
  // Webhook endpoint not for public documentation
}
```

## Testing Standards

### Unit Test Structure

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Subscription } from '../../database/entities/subscription.entity';

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
    repository = module.get(getRepositoryToken(Subscription));
  });

  describe('getUserSubscription', () => {
    it('should return subscription for valid user', async () => {
      const userId = 'user-id';
      const subscription = { id: 'sub-id', userId, plan: 'monthly' };

      repository.findOne.mockResolvedValue(subscription);

      const result = await service.getUserSubscription(userId);

      expect(result).toEqual(subscription);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { userId } });
    });

    it('should return null when subscription not found', async () => {
      repository.findOne.mockResolvedValue(null);

      const result = await service.getUserSubscription('user-id');

      expect(result).toBeNull();
    });
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

Run `npm run format` before committing to ensure consistent formatting.

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

// 4. Types and interfaces
import type { AppConfiguration } from '../../config/app-configuration';
```

## Performance Considerations

### Database Queries

**Avoid N+1 queries - use relations:**
```typescript
// Good
const subscriptions = await this.repository.find({
  where: { userId },
  relations: ['user'],
});

// Avoid
const subscriptions = await this.repository.find({ where: { userId } });
for (const sub of subscriptions) {
  sub.user = await this.userRepository.findOne({ where: { id: sub.userId } });
}
```

**Use select for partial data:**
```typescript
const users = await this.repository.find({
  select: ['id', 'email', 'name'],
  where: { emailVerified: true },
});
```

### Async Processing

**Use `setImmediate()` for non-blocking webhooks:**
```typescript
@Post('webhook')
async handleWebhook(@Body() payload: WebhookDto): Promise<{ status: string }> {
  // Respond immediately
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

Use inline comments sparingly for complex logic:

```typescript
// Timing-safe comparison to prevent timing attacks
if (!timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))) {
  throw new UnauthorizedException();
}

// Respond immediately, process asynchronously to meet 60s requirement
setImmediate(() => this.processWebhook(payload));
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

## Deprecated Patterns

### Avoid These Patterns

**Don't use any type:**
```typescript
// Avoid
function processData(data: any) {}

// Use
function processData(data: WebhookPayload) {}
```

**Don't use var:**
```typescript
// Avoid
var userId = user.id;

// Use
const userId = user.id;
```

**Don't ignore errors:**
```typescript
// Avoid
try {
  await this.process();
} catch {}

// Use
try {
  await this.process();
} catch (error) {
  this.logger.error('Processing failed', error.stack);
  throw error;
}
```

**Don't use synchronous methods in async contexts:**
```typescript
// Avoid
async function readConfig() {
  return fs.readFileSync('config.json');
}

// Use
async function readConfig() {
  return fs.promises.readFile('config.json');
}
```
