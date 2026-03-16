# Backend Subscription & RevenueCat Integration Research

**Date:** 2026-03-13
**Status:** Complete
**Scope:** NestJS backend subscription system architecture and RevenueCat integration

---

## Executive Summary

The Flowering backend implements a mature subscription system integrated with RevenueCat for handling IAP (In-App Purchase) lifecycle events. Key findings:

- **Subscription Model**: Enum-based (FREE, MONTHLY, YEARLY, LIFETIME) with status tracking (ACTIVE, EXPIRED, CANCELLED, TRIAL)
- **RevenueCat Integration**: Webhook-based with timing-safe auth validation and idempotent event processing
- **API Pattern**: All responses wrapped in `{code, message, data}` format where code=1 (success), code=0 (error)
- **Schema**: 1:1 user-to-subscription relationship stored in `subscriptions` table
- **Event Types**: 7 webhook event types handled (INITIAL_PURCHASE, RENEWAL, CANCELLATION, UNCANCELLATION, EXPIRATION, BILLING_ISSUE, PRODUCT_CHANGE)

---

## 1. Subscription Entity Schema

### Database Table: `subscriptions`

```sql
CREATE TABLE "subscriptions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID UNIQUE NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "plan" subscription_plan_enum DEFAULT 'free',
  "status" subscription_status_enum DEFAULT 'active',
  "revenuecat_id" VARCHAR(255),
  "current_period_start" TIMESTAMPTZ,
  "current_period_end" TIMESTAMPTZ,
  "cancel_at_period_end" BOOLEAN DEFAULT false,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);
```

### TypeORM Entity (`subscription.entity.ts`)

**Plans (SubscriptionPlan enum):**
- `FREE` - Default plan for new users
- `MONTHLY` - Monthly subscription
- `YEARLY` - Annual subscription
- `LIFETIME` - One-time lifetime access

**Status (SubscriptionStatus enum):**
- `ACTIVE` - Valid, in current period
- `EXPIRED` - Past current_period_end
- `CANCELLED` - User cancelled but might still be in period
- `TRIAL` - Trial period

**Key Fields:**
- `revenuecatId`: RevenueCat subscriber identifier (nullable, set during purchase)
- `currentPeriodStart/End`: Subscription billing period dates
- `cancelAtPeriodEnd`: Grace flag for cancellations (subscription ends at period end, not immediately)

**Relationship:**
- ManyToOne → User (unique index means one subscription per user)
- Foreign key cascades on user deletion

---

## 2. Subscription Entity Code Structure

**File:** `/src/database/entities/subscription.entity.ts`

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

---

## 3. API Endpoints

### Controller: `subscription.controller.ts`

**Endpoint:** `GET /subscriptions/me`
- **Auth:** JWT (requires authenticated user)
- **Input:** User from `@CurrentUser()` decorator
- **Output:** `BaseResponseDto<SubscriptionDto | null>`
- **Logic:** Calls `subscriptionService.getUserSubscription(user.id)`

**Response Format (Success):**
```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "id": "uuid",
    "plan": "monthly",
    "status": "active",
    "expiresAt": "2026-04-13T00:00:00Z",
    "isActive": true,
    "cancelAtPeriodEnd": false
  }
}
```

**Response Format (No Subscription):**
```json
{
  "code": 1,
  "message": "Success",
  "data": null
}
```

---

## 4. Subscription DTOs

**File:** `/src/modules/subscription/dto/subscription.dto.ts`

```typescript
export class SubscriptionDto {
  @ApiProperty({ description: 'Subscription ID' })
  id!: string;

  @ApiProperty({ description: 'Plan type', enum: SubscriptionPlan })
  plan!: SubscriptionPlan;

  @ApiProperty({ description: 'Subscription status', enum: SubscriptionStatus })
  status!: SubscriptionStatus;

  @ApiPropertyOptional({ description: 'Current period end date' })
  expiresAt?: Date | null;

  @ApiProperty({ description: 'Whether subscription is currently active' })
  isActive!: boolean;

  @ApiProperty({ description: 'Whether subscription will cancel at period end' })
  cancelAtPeriodEnd!: boolean;
}
```

**Computed Fields:**
- `isActive`: Calculated at return time based on:
  - Status must be ACTIVE
  - If LIFETIME plan → always active
  - If has expiry → must be > current time

---

## 5. RevenueCat Webhook Handler

### Webhook Controller: `revenuecat-webhook.controller.ts`

**Endpoint:** `POST /webhooks/revenuecat`
- **Auth:** Custom bearer token (timing-safe comparison)
- **Security:** `@Public()` decorator (bypasses JWT guard)
- **Response:** 200 OK immediately (async processing via `setImmediate`)
- **Timeout:** Must respond within 60 seconds

**Auth Mechanism:**
```typescript
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

**Error Handling:**
- Invalid auth → 401 UnauthorizedException
- Processing errors logged but don't affect response

---

## 6. RevenueCat Event Types & DTO

**File:** `/src/modules/subscription/dto/revenuecat-webhook.dto.ts`

**Event Types Handled:**
- `INITIAL_PURCHASE` - First purchase event
- `RENEWAL` - Subscription renewed
- `CANCELLATION` - User cancelled (grace period until `currentPeriodEnd`)
- `UNCANCELLATION` - User re-enabled cancelled sub
- `EXPIRATION` - Period ended
- `BILLING_ISSUE` - Payment failure
- `PRODUCT_CHANGE` - Plan changed mid-period

**RevenueCatEventDto Structure:**
```typescript
export class RevenueCatEventDto {
  id: string;                              // Unique event ID (for idempotency)
  type: RevenueCatEventType;               // Event type enum
  app_user_id: string;                     // Our user ID (maps to subscription.userId)
  original_app_user_id: string;            // Original user ID (stored in revenuecatId)
  product_id: string;                      // Store product ID (e.g., "monthly_plan", "yearly_plan")
  entitlement_id?: string;                 // Optional entitlement identifier
  expiration_at_ms?: number;               // Unix timestamp (ms)
  purchased_at_ms?: number;                // Unix timestamp (ms)
  environment: 'SANDBOX' | 'PRODUCTION';   // Event source
}
```

---

## 7. RevenueCat Event Processing

### Service: `subscription.service.ts`

**Core Processing Flow:**

1. **Idempotency Check:**
   ```typescript
   private processedEvents = new Set<string>();

   if (this.processedEvents.has(event.id)) {
     this.logger.debug(`Event ${event.id} already processed, skipping`);
     return;
   }
   this.processedEvents.add(event.id);
   ```
   - In-memory set (production should use Redis)
   - Prevents duplicate webhook processing

2. **User Lookup:**
   ```typescript
   const user = await this.userRepo.findOne({ where: { id: event.app_user_id } });
   if (!user) {
     this.logger.warn(`User not found for RevenueCat ID: ${event.app_user_id}`);
     return;
   }
   ```

3. **Event Routing:**
   ```typescript
   switch (event.type) {
     case 'INITIAL_PURCHASE':
     case 'RENEWAL':
     case 'UNCANCELLATION':
       await this.handlePurchaseOrRenewal(user.id, event);
       break;
     case 'CANCELLATION':
       await this.handleCancellation(user.id);
       break;
     case 'EXPIRATION':
       await this.handleExpiration(user.id);
       break;
     case 'BILLING_ISSUE':
       await this.handleBillingIssue(user.id);
       break;
     case 'PRODUCT_CHANGE':
       await this.handlePurchaseOrRenewal(user.id, event);
       break;
   }
   ```

### Event Handlers:

**handlePurchaseOrRenewal:**
- Maps `product_id` to SubscriptionPlan (case-insensitive pattern matching)
- Extracts expiry from `expiration_at_ms`
- Upserts/updates subscription with ACTIVE status
- Sets `currentPeriodStart` and `currentPeriodEnd`

**handleCancellation:**
- Sets `cancelAtPeriodEnd: true` (not immediate termination)
- User keeps access until current period ends

**handleExpiration:**
- Sets status to EXPIRED
- Clears `cancelAtPeriodEnd` flag

**handleBillingIssue:**
- Logged as warning (no action in current implementation)

### Product ID to Plan Mapping:
```typescript
private mapProductToPlan(productId: string): SubscriptionPlan {
  const lowerProductId = productId.toLowerCase();

  if (lowerProductId.includes('lifetime')) {
    return SubscriptionPlan.LIFETIME;
  }
  if (lowerProductId.includes('yearly') || lowerProductId.includes('annual')) {
    return SubscriptionPlan.YEARLY;
  }
  if (lowerProductId.includes('monthly')) {
    return SubscriptionPlan.MONTHLY;
  }

  return SubscriptionPlan.MONTHLY; // Default
}
```

---

## 8. RevenueCat Configuration

**Environment Variables:**

```env
REVENUECAT_API_KEY=your-revenuecat-api-key
REVENUECAT_WEBHOOK_SECRET=your-webhook-secret
```

**Config File:** `/src/config/app-configuration.ts`

```typescript
revenuecat: {
  apiKey?: string;           // Optional for future API calls
  webhookSecret?: string;    // Required for webhook auth
}
```

**Validation Schema:** `/src/config/environment-validation-schema.ts`

```typescript
REVENUECAT_API_KEY: Joi.string().allow('').optional(),
REVENUECAT_WEBHOOK_SECRET: Joi.string().allow('').optional(),
```

---

## 9. Response Wrapper Pattern

**Global Response Format:**

All API responses follow this wrapper pattern:

```typescript
{
  "code": number,        // 1 = success, 0 = error
  "message": string,     // Human-readable message
  "data": T | null       // Response payload
}
```

**Implementation:**

- **DTO:** `/src/common/dto/base-response.dto.ts`
- **Interceptor:** `/src/common/interceptors/response-transform.interceptor.ts`

The interceptor automatically wraps all endpoint returns in `BaseResponseDto.success(data)` unless already wrapped.

---

## 10. Module Structure

**File:** `/src/modules/subscription/subscription.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([Subscription, User])],
  controllers: [SubscriptionController, RevenuecatWebhookController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
```

**Exports:** `SubscriptionService` (for injection in other modules)

**Integration:** Imported in `app.module.ts` alongside other feature modules

---

## 11. User-Subscription Relationship

**Database Relationship:**
- **Type:** One-to-Many (User → Multiple subscription records theoretically, but unique constraint enforces 1:1)
- **Cascade:** DELETE CASCADE on user deletion
- **Lookup:** `subscriptionRepo.findOne({ where: { userId } })`

**User Entity Reference:**
```typescript
@ManyToOne(() => Language, { nullable: true })
@JoinColumn({ name: 'native_language_id' })
nativeLanguage?: Language;
```

User does NOT have explicit subscription relation defined in entity, but it's implicit via foreign key.

---

## 12. Key Implementation Details

### Idempotency Strategy:
- Uses in-memory Set (not persistent)
- In production, should use Redis with TTL or database deduplication
- Falls back silently if event already processed

### Subscription Activity Calculation:
```typescript
private isSubscriptionActive(subscription: Subscription): boolean {
  if (subscription.status !== SubscriptionStatus.ACTIVE) return false;
  if (subscription.plan === SubscriptionPlan.LIFETIME) return true;
  if (!subscription.currentPeriodEnd) return true;
  return subscription.currentPeriodEnd > new Date();
}
```

### Async Webhook Processing:
```typescript
setImmediate(() => {
  this.subscriptionService.processWebhook(payload).catch((err) => {
    this.logger.error(`Webhook processing error: ${err.message}`, err.stack);
  });
});
```

- Returns 200 OK immediately
- Processing happens asynchronously
- Ensures <60s response window

---

## 13. Known Limitations & Gaps

1. **Idempotency Persistence:**
   - Current: In-memory Set (lost on app restart)
   - Should: Use Redis or DB-based deduplication

2. **Sync Endpoint Missing:**
   - Planning phase mentions `POST /subscriptions/sync` for RevenueCat API calls
   - Not found in actual controller
   - Could be useful for backup sync

3. **No Entitlement Mapping:**
   - Webhooks include `entitlement_id` field but not used
   - Could enable more granular feature gating

4. **No Subscription History:**
   - Only current subscription tracked
   - No audit trail of plan changes

5. **Webhook Queue:**
   - No message queue (Bull, RabbitMQ)
   - Failures not retried
   - Production should add reliability layer

---

## 14. Testing & Deployment Considerations

**Webhook Testing:**
- RevenueCat dashboard provides sandbox webhook testing
- Can be manually triggered with test events
- Must configure correct webhook URL in RevenueCat dashboard

**Database Setup:**
- Migration creates subscription enum types automatically
- Subscription table created with correct schema
- No manual data seeding required

**Error Handling:**
- Webhook auth failures logged as warnings
- Processing errors logged but don't fail the response
- Failed tokens cleanup in notifications module (separate)

---

## 15. Architecture Diagram

```
┌─────────────────────────────────────┐
│     Flutter Mobile App              │
│  (GET /subscriptions/me)            │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   NestJS Backend API                │
│  ┌─────────────────────────────────┐│
│  │ SubscriptionController          ││
│  │ @Get('me') → getUserSubscription││
│  └────────────┬────────────────────┘│
│               │                      │
│  ┌────────────▼────────────────────┐│
│  │ SubscriptionService             ││
│  │ - getUserSubscription(userId)   ││
│  │ - processWebhook(payload)       ││
│  │ - handlePurchaseOrRenewal()     ││
│  │ - handleCancellation()          ││
│  │ - handleExpiration()            ││
│  └────────────┬────────────────────┘│
│               │                      │
│  ┌────────────▼────────────────────┐│
│  │ TypeORM Repository<Subscription>││
│  │ findOne(), update(), save()     ││
│  └────────────┬────────────────────┘│
│               │                      │
└───────────────┼──────────────────────┘
                │
     ┌──────────▼──────────┐
     │  PostgreSQL (       │
     │  Supabase)          │
     │  subscriptions table│
     └─────────────────────┘

┌─────────────────────────────────────┐
│     RevenueCat Service              │
│  (Sends webhook events)             │
└──────────────┬──────────────────────┘
               │
     ┌─────────▼──────────┐
     │ POST /webhooks/    │
     │ revenuecat         │
     │ (public endpoint)  │
     └────────────────────┘
                │
     ┌──────────▼──────────┐
     │ RevenueCat Webhook  │
     │ Controller          │
     │ - Auth verification │
     │ - Async processing  │
     │ - Response <60s     │
     └────────────────────┘
```

---

## 16. File Location Summary

| Component | File Path |
|-----------|-----------|
| Entity | `/src/database/entities/subscription.entity.ts` |
| Controller | `/src/modules/subscription/subscription.controller.ts` |
| Service | `/src/modules/subscription/subscription.service.ts` |
| DTOs | `/src/modules/subscription/dto/subscription.dto.ts` |
| Webhook Controller | `/src/modules/subscription/webhooks/revenuecat-webhook.controller.ts` |
| Webhook DTOs | `/src/modules/subscription/dto/revenuecat-webhook.dto.ts` |
| Module | `/src/modules/subscription/subscription.module.ts` |
| Config | `/src/config/app-configuration.ts` |
| Response Wrapper | `/src/common/dto/base-response.dto.ts` |
| Response Interceptor | `/src/common/interceptors/response-transform.interceptor.ts` |
| Database Migration | `/src/database/migrations/1706976000000-initial-schema.ts` |

---

## 17. Unresolved Questions

1. **Webhook Idempotency in Production:** How should persistent idempotency be implemented? (Redis, database table, or external service?)

2. **Subscription Sync Endpoint:** Should `POST /subscriptions/sync` be implemented to call RevenueCat API directly for backup/verification?

3. **Entitlement System:** How are entitlements (specific features) mapped to plans? Currently not implemented in code.

4. **Webhook Retry Logic:** What should happen if webhook processing fails? Current implementation doesn't retry.

5. **Feature Gating:** How are premium features locked to non-premium users? Need to check AI module and lesson module for usage.

6. **Subscription History:** Should we track plan changes over time for analytics?

7. **Cancellation Grace Period:** Is the `cancelAtPeriodEnd` flag properly surfaced to mobile UI so users know their expiration date?

---

## Summary

The backend subscription system is well-structured with:
- Clear enum-based plan and status tracking
- Secure, timing-safe webhook authentication
- Idempotent event processing
- Proper async handling for RevenueCat's 60-second requirement
- Standard response wrapping pattern for all APIs
- 1:1 user-subscription relationship with cascade delete

The mobile app can reliably query current subscription status via `GET /subscriptions/me` and handle plan differences in the UI accordingly.
