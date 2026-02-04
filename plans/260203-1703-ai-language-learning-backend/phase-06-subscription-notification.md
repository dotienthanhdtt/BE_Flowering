# Phase 06: Subscription & Notification Modules

## Overview

| Field | Value |
|-------|-------|
| Priority | P2 - Important |
| Status | completed |
| Effort | 4h |
| Dependencies | Phase 02, Phase 03 |

Implement RevenueCat webhook handler for subscription management and Firebase Admin SDK for push notifications. Handle subscription lifecycle events and device token management.

## Key Insights

From research:
- RevenueCat sends webhooks for purchase/renewal/cancellation events
- Response must be returned within 60s (defer processing)
- Idempotency key (`event.id`) prevents duplicate processing
- Firebase Admin SDK uses service account credentials
- FCM tokens must be managed (invalid tokens removed)

## Requirements

### Functional
- RevenueCat webhook endpoint with auth verification
- Process subscription events (purchase, renewal, cancellation, expiration)
- Query user subscription status
- Register device tokens for push notifications
- Send push notifications (single, multicast, topic)
- Handle invalid/expired FCM tokens

### Non-Functional
- Webhook response <60s
- Idempotent event processing
- Async webhook processing

## Architecture

```
src/modules/
├── subscription/
│   ├── subscription.module.ts
│   ├── subscription.controller.ts
│   ├── subscription.service.ts
│   ├── webhooks/
│   │   └── revenuecat-webhook.controller.ts
│   └── dto/
│       ├── subscription.dto.ts
│       └── revenuecat-webhook.dto.ts
└── notification/
    ├── notification.module.ts
    ├── notification.service.ts
    ├── firebase.service.ts
    └── dto/
        ├── register-device.dto.ts
        └── send-notification.dto.ts
```

## Related Code Files

### Subscription Module
- `src/modules/subscription/subscription.module.ts`
- `src/modules/subscription/subscription.controller.ts`
- `src/modules/subscription/subscription.service.ts`
- `src/modules/subscription/webhooks/revenuecat-webhook.controller.ts`
- `src/modules/subscription/dto/subscription.dto.ts`
- `src/modules/subscription/dto/revenuecat-webhook.dto.ts`

### Notification Module
- `src/modules/notification/notification.module.ts`
- `src/modules/notification/notification.service.ts`
- `src/modules/notification/firebase.service.ts`
- `src/modules/notification/dto/register-device.dto.ts`
- `src/modules/notification/dto/send-notification.dto.ts`

## Implementation Steps

### Step 1: Install Dependencies (5min)

```bash
npm install firebase-admin
```

### Step 2: Create RevenueCat Webhook DTOs (20min)

```typescript
// src/modules/subscription/dto/revenuecat-webhook.dto.ts
export class RevenueCatWebhookDto {
  @ApiProperty()
  api_version: string;

  @ApiProperty()
  event: RevenueCatEventDto;
}

export class RevenueCatEventDto {
  @ApiProperty()
  id: string;  // For idempotency

  @ApiProperty()
  type: RevenueCatEventType;

  @ApiProperty()
  app_user_id: string;

  @ApiProperty()
  original_app_user_id: string;

  @ApiProperty()
  product_id: string;

  @ApiProperty({ required: false })
  entitlement_id?: string;

  @ApiProperty({ required: false })
  expiration_at_ms?: number;

  @ApiProperty()
  environment: 'SANDBOX' | 'PRODUCTION';
}

export type RevenueCatEventType =
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'CANCELLATION'
  | 'UNCANCELLATION'
  | 'EXPIRATION'
  | 'BILLING_ISSUE';
```

### Step 3: Create Subscription Service (60min)

```typescript
// src/modules/subscription/subscription.service.ts
@Injectable()
export class SubscriptionService {
  private processedEvents = new Set<string>();

  constructor(
    @InjectRepository(Subscription)
    private subscriptionRepo: Repository<Subscription>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  // Get user's current subscription
  async getUserSubscription(userId: string): Promise<SubscriptionDto | null> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    if (!subscription) return null;

    return {
      id: subscription.id,
      planType: subscription.planType,
      status: subscription.status,
      expiresAt: subscription.expiresAt,
      isActive: this.isSubscriptionActive(subscription),
    };
  }

  // Process RevenueCat webhook
  async processWebhook(payload: RevenueCatWebhookDto): Promise<void> {
    const { event } = payload;

    // Idempotency check
    if (this.processedEvents.has(event.id)) {
      return;
    }
    this.processedEvents.add(event.id);

    // Find or create user by RevenueCat app_user_id
    const user = await this.findUserByRevenueCatId(event.app_user_id);
    if (!user) {
      console.warn(`User not found for RevenueCat ID: ${event.app_user_id}`);
      return;
    }

    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
        await this.handlePurchaseOrRenewal(user, event);
        break;
      case 'CANCELLATION':
        await this.handleCancellation(user, event);
        break;
      case 'EXPIRATION':
        await this.handleExpiration(user, event);
        break;
      case 'BILLING_ISSUE':
        await this.handleBillingIssue(user, event);
        break;
    }
  }

  private async handlePurchaseOrRenewal(user: User, event: RevenueCatEventDto): Promise<void> {
    const planType = this.mapProductToPlan(event.product_id);
    const expiresAt = event.expiration_at_ms
      ? new Date(event.expiration_at_ms)
      : null;

    await this.subscriptionRepo.upsert(
      {
        userId: user.id,
        revenuecatId: event.app_user_id,
        planType,
        status: 'active',
        expiresAt,
      },
      ['userId'],
    );
  }

  private async handleCancellation(user: User, event: RevenueCatEventDto): Promise<void> {
    await this.subscriptionRepo.update(
      { userId: user.id },
      { status: 'cancelled' },
    );
  }

  private async handleExpiration(user: User, event: RevenueCatEventDto): Promise<void> {
    await this.subscriptionRepo.update(
      { userId: user.id },
      { status: 'expired' },
    );
  }

  private mapProductToPlan(productId: string): string {
    const mapping: Record<string, string> = {
      'monthly_premium': 'monthly',
      'yearly_premium': 'yearly',
      'lifetime_premium': 'lifetime',
    };
    return mapping[productId] || 'free';
  }

  private isSubscriptionActive(subscription: Subscription): boolean {
    if (subscription.status !== 'active') return false;
    if (!subscription.expiresAt) return true;
    return subscription.expiresAt > new Date();
  }

  // Sync with RevenueCat API (backup to webhooks)
  async syncSubscription(userId: string): Promise<SubscriptionDto | null> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return null;

    const response = await this.httpService.axiosRef.get(
      `https://api.revenuecat.com/v1/subscribers/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${this.configService.get('REVENUECAT_API_KEY')}`,
        },
      },
    );

    // Process subscriber data and update local database
    const subscriberInfo = response.data.subscriber;
    // ... update subscription based on entitlements

    return this.getUserSubscription(userId);
  }
}
```

### Step 4: Create RevenueCat Webhook Controller (30min)

```typescript
// src/modules/subscription/webhooks/revenuecat-webhook.controller.ts
@Controller('webhooks')
export class RevenueCatWebhookController {
  constructor(private subscriptionService: SubscriptionService) {}

  @Public()
  @Post('revenuecat')
  @HttpCode(200)
  @ApiOperation({ summary: 'RevenueCat webhook endpoint' })
  @ApiExcludeEndpoint() // Hide from Swagger
  async handleWebhook(
    @Headers('authorization') authHeader: string,
    @Body() payload: RevenueCatWebhookDto,
  ): Promise<{ status: string }> {
    // Verify webhook authorization
    const expectedAuth = this.configService.get('REVENUECAT_WEBHOOK_SECRET');
    if (authHeader !== `Bearer ${expectedAuth}`) {
      throw new UnauthorizedException('Invalid webhook authorization');
    }

    // Respond immediately, process asynchronously
    // Note: In production, use a queue (Bull, RabbitMQ) for reliability
    setImmediate(() => {
      this.subscriptionService.processWebhook(payload).catch(err => {
        console.error('Webhook processing error:', err);
        // In production: Send to Sentry, retry queue
      });
    });

    return { status: 'received' };
  }
}
```

### Step 5: Create Subscription Controller (20min)

```typescript
// src/modules/subscription/subscription.controller.ts
@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionController {
  constructor(private subscriptionService: SubscriptionService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user subscription' })
  async getSubscription(@CurrentUser() user: User): Promise<SubscriptionDto | null> {
    return this.subscriptionService.getUserSubscription(user.id);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Sync subscription with RevenueCat' })
  async syncSubscription(@CurrentUser() user: User): Promise<SubscriptionDto | null> {
    return this.subscriptionService.syncSubscription(user.id);
  }
}
```

### Step 6: Create Firebase Service (40min)

```typescript
// src/modules/notification/firebase.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private messaging: admin.messaging.Messaging;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: this.configService.get('FIREBASE_PROJECT_ID'),
          clientEmail: this.configService.get('FIREBASE_CLIENT_EMAIL'),
          privateKey: this.configService.get('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
        }),
      });
    }

    this.messaging = admin.messaging();
  }

  // Send to single device
  async sendToDevice(
    token: string,
    notification: NotificationPayload,
  ): Promise<string> {
    const message: admin.messaging.Message = {
      token,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data,
      android: {
        priority: 'high',
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    };

    return await this.messaging.send(message);
  }

  // Send to multiple devices
  async sendToDevices(
    tokens: string[],
    notification: NotificationPayload,
  ): Promise<MulticastResult> {
    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data,
    };

    const response = await this.messaging.sendEachForMulticast(message);

    // Collect failed tokens for cleanup
    const failedTokens: string[] = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const error = resp.error;
        if (
          error?.code === 'messaging/invalid-registration-token' ||
          error?.code === 'messaging/registration-token-not-registered'
        ) {
          failedTokens.push(tokens[idx]);
        }
      }
    });

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      failedTokens,
    };
  }

  // Subscribe tokens to topic
  async subscribeToTopic(tokens: string[], topic: string): Promise<void> {
    await this.messaging.subscribeToTopic(tokens, topic);
  }

  // Send to topic
  async sendToTopic(topic: string, notification: NotificationPayload): Promise<string> {
    return await this.messaging.send({
      topic,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data,
    });
  }
}

interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface MulticastResult {
  successCount: number;
  failureCount: number;
  failedTokens: string[];
}
```

### Step 7: Create Notification Service (40min)

```typescript
// src/modules/notification/notification.service.ts
@Injectable()
export class NotificationService {
  constructor(
    private firebaseService: FirebaseService,
    @InjectRepository(DeviceToken)
    private deviceTokenRepo: Repository<DeviceToken>,
  ) {}

  // Register device token
  async registerDevice(userId: string, dto: RegisterDeviceDto): Promise<void> {
    await this.deviceTokenRepo.upsert(
      {
        userId,
        token: dto.token,
        platform: dto.platform,
      },
      ['userId', 'token'],
    );
  }

  // Unregister device token
  async unregisterDevice(userId: string, token: string): Promise<void> {
    await this.deviceTokenRepo.delete({ userId, token });
  }

  // Send notification to user
  async sendToUser(userId: string, notification: NotificationPayload): Promise<void> {
    const devices = await this.deviceTokenRepo.find({
      where: { userId },
    });

    if (devices.length === 0) return;

    const tokens = devices.map(d => d.token);
    const result = await this.firebaseService.sendToDevices(tokens, notification);

    // Clean up invalid tokens
    if (result.failedTokens.length > 0) {
      await this.deviceTokenRepo.delete({
        token: In(result.failedTokens),
      });
    }
  }

  // Send lesson reminder
  async sendLessonReminder(userId: string, lessonTitle: string): Promise<void> {
    await this.sendToUser(userId, {
      title: 'Time to practice!',
      body: `Continue your "${lessonTitle}" lesson`,
      data: { type: 'lesson_reminder' },
    });
  }

  // Send streak notification
  async sendStreakNotification(userId: string, streakDays: number): Promise<void> {
    await this.sendToUser(userId, {
      title: `${streakDays} day streak!`,
      body: `Keep it up! Don't break your learning streak.`,
      data: { type: 'streak', days: streakDays.toString() },
    });
  }

  // Send achievement notification
  async sendAchievementNotification(
    userId: string,
    achievementName: string,
  ): Promise<void> {
    await this.sendToUser(userId, {
      title: 'Achievement Unlocked!',
      body: `You earned: ${achievementName}`,
      data: { type: 'achievement' },
    });
  }
}
```

### Step 8: Create Notification Controller (20min)

```typescript
// src/modules/notification/notification.controller.ts
@ApiTags('notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  @Post('devices')
  @ApiOperation({ summary: 'Register device for push notifications' })
  async registerDevice(
    @CurrentUser() user: User,
    @Body() dto: RegisterDeviceDto,
  ): Promise<void> {
    return this.notificationService.registerDevice(user.id, dto);
  }

  @Delete('devices/:token')
  @ApiOperation({ summary: 'Unregister device' })
  async unregisterDevice(
    @CurrentUser() user: User,
    @Param('token') token: string,
  ): Promise<void> {
    return this.notificationService.unregisterDevice(user.id, token);
  }
}
```

## Todo List

### Subscription Module
- [x] Create RevenueCatWebhookDto
- [x] Create SubscriptionDto
- [x] Implement SubscriptionService
- [x] Implement handlePurchaseOrRenewal
- [x] Implement handleCancellation
- [x] Implement handleExpiration
- [x] Implement idempotency checking
- [x] Create RevenueCatWebhookController
- [x] Create SubscriptionController
- [x] Add environment variables for RevenueCat

### Notification Module
- [x] Create FirebaseService with admin SDK
- [x] Implement sendToDevice
- [x] Implement sendToDevices with token cleanup
- [x] Implement topic subscription
- [x] Create NotificationService
- [x] Implement registerDevice
- [x] Implement sendToUser
- [x] Create NotificationController
- [x] Add environment variables for Firebase
- [x] Write unit tests for subscription events
- [x] Test webhook with RevenueCat sandbox

## Success Criteria

- [x] POST /webhooks/revenuecat accepts valid webhooks
- [x] Invalid webhook auth rejected with 401
- [x] Duplicate events ignored (idempotency)
- [x] GET /subscriptions/me returns current subscription
- [x] POST /notifications/devices registers FCM token
- [x] Push notifications sent successfully
- [x] Invalid FCM tokens cleaned up automatically

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Webhook delivery failure | Low | Medium | Use RevenueCat API as backup |
| FCM token invalidation | Medium | Low | Clean up on send failure |
| Webhook processing timeout | Low | Medium | Async processing with queue |

## Security Considerations

- Webhook endpoint validates authorization header
- Firebase service account key in environment only
- No PII in push notification data payload
- Rate limit webhook endpoint (prevent abuse)
