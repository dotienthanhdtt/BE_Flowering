# Supabase, RevenueCat, Firebase & Sentry Integration Research

**Report ID:** researcher-02-supabase-integrations
**Date:** 2026-02-03
**Scope:** Backend integrations for AI Language Learning app

---

## 1. Supabase PostgreSQL + NestJS

### Connection Patterns

**Three connection modes available:**

1. **Direct Connection** (port 5432)
   - For long-running VMs/containers
   - IPv6 only by default
   - Best for persistent backends

2. **Pooler Session Mode** (port 5432 via Supavisor)
   - For persistent clients needing IPv4/IPv6
   - Maintains connection state
   - Supports prepared statements

3. **Pooler Transaction Mode** (port 6543)
   - For serverless/edge functions
   - Transient connections
   - **Requires disabling prepared statements**

### NestJS Configuration

```typescript
// app.module.ts - TypeORM example
TypeOrmModule.forRoot({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  extra: {
    max: 10,           // connection pool size
    min: 2,
    idleTimeoutMillis: 30000,
  },
  autoLoadEntities: true,
})
```

### Environment Variables

```env
# Direct connection
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres

# Transaction pooler (for serverless)
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:6543/postgres?pgbouncer=true

SUPABASE_URL=https://[PROJECT_REF].supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Migration Strategy

Use Supabase CLI or Prisma migrations. For RLS policies:

```sql
-- Enable RLS on tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_files ENABLE ROW LEVEL SECURITY;
```

### Row Level Security Policies

**User isolation pattern:**

```sql
-- SELECT: Users see only their data
CREATE POLICY "user_select_own" ON profiles
FOR SELECT USING (auth.uid() = user_id);

-- INSERT: Users create only their records
CREATE POLICY "user_insert_own" ON lessons
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users modify only their data
CREATE POLICY "user_update_own" ON lessons
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

**Best practices:**
- Add indexes on columns used in policies
- Cache `auth.uid()` using SELECT wrapper: `(SELECT auth.uid())`
- Specify roles (`TO authenticated`) to avoid running policies for anonymous users
- Use security definer functions for complex joins to bypass RLS overhead

---

## 2. Supabase Storage for Audio Files

### Upload Pattern (Node.js/NestJS)

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Upload audio file (< 6MB recommended for standard upload)
async uploadAudio(file: Buffer, userId: string, fileName: string) {
  const filePath = `${userId}/audio/${Date.now()}-${fileName}`;

  const { data, error } = await supabase.storage
    .from('audio-files')
    .upload(filePath, file, {
      contentType: 'audio/mpeg',
      upsert: false, // Prevent overwriting
    });

  if (error) throw error;
  return data.path;
}
```

### Signed URLs for Download

```typescript
async getSignedUrl(filePath: string, expiresIn: number = 3600) {
  const { data, error } = await supabase.storage
    .from('audio-files')
    .createSignedUrl(filePath, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}
```

**Key points:**
- Standard upload limit: 6MB (use TUS for larger files)
- Max file size: 5GB
- Signed URLs expire after specified seconds (default: 3600s/1hr)
- Use unique file paths instead of overwriting to avoid CDN cache issues

---

## 3. RevenueCat Webhook Integration

### Webhook Events

RevenueCat sends POST requests for subscription lifecycle events:
- Purchase events
- Cancellation events (within 2hrs)
- Renewal events
- Expiration events

### Payload Structure

```typescript
interface RevenueCatWebhook {
  id: string;           // For deduplication
  event: {
    type: string;       // Event type
    environment: 'SANDBOX' | 'PRODUCTION';
    // ... event-specific fields
  };
}
```

### NestJS Controller Implementation

```typescript
@Controller('webhooks')
export class WebhookController {
  private processedEvents = new Set<string>();

  @Post('revenuecat')
  async handleRevenueCat(
    @Headers('authorization') authHeader: string,
    @Body() payload: RevenueCatWebhook,
  ) {
    // 1. Verify authorization header
    if (authHeader !== process.env.REVENUECAT_WEBHOOK_AUTH) {
      throw new UnauthorizedException();
    }

    // 2. Check idempotency
    if (this.processedEvents.has(payload.id)) {
      return { status: 'already_processed' };
    }

    // 3. Respond quickly (within 60s timeout)
    this.processedEvents.add(payload.id);

    // 4. Defer processing
    this.subscriptionService.processWebhook(payload);

    return { status: 'received' };
  }
}
```

### Best Practices

- **Verification:** Validate authorization header on every request
- **Idempotency:** Track event IDs to prevent duplicate processing
- **Quick response:** Return 200 status within 60s
- **Deferred processing:** Handle business logic asynchronously
- **Retry handling:** RevenueCat retries up to 5 times (5, 10, 20, 40, 80 min intervals)
- **Data sync:** Call `GET /subscribers` API after webhook instead of parsing each event type

---

## 4. Firebase Admin SDK for Push Notifications

### Setup

```bash
npm install firebase-admin
```

### Service Configuration

```typescript
// firebase.service.ts
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private messaging: admin.messaging.Messaging;

  onModuleInit() {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });

    this.messaging = admin.messaging();
  }
}
```

### Send Single Notification

```typescript
async sendNotification(token: string, notification: {
  title: string;
  body: string;
  data?: Record<string, string>;
}) {
  const message = {
    token,
    notification: {
      title: notification.title,
      body: notification.body,
    },
    data: notification.data,
  };

  return await this.messaging.send(message);
}
```

### Multicast (Multiple Devices)

```typescript
async sendMulticast(tokens: string[], notification: any) {
  const message = {
    tokens,
    notification,
  };

  const response = await this.messaging.sendEachForMulticast(message);
  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    responses: response.responses,
  };
}
```

### Topic Subscription

```typescript
async subscribeToTopic(tokens: string[], topic: string) {
  return await this.messaging.subscribeToTopic(tokens, topic);
}

async sendToTopic(topic: string, notification: any) {
  return await this.messaging.send({
    topic,
    notification,
  });
}
```

---

## 5. Sentry NestJS Integration

### Installation

```bash
npm install @sentry/nestjs @sentry/profiling-node
```

### Setup Steps

**1. Create instrument.ts (root level):**

```typescript
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,      // Adjust for production
  profilesSampleRate: 0.1,     // Relative to traces
  enableLogs: true,
  integrations: [nodeProfilingIntegration()],
});
```

**2. Import in main.ts (FIRST):**

```typescript
import './instrument';  // Must be first!
import { NestFactory } from '@nestjs/core';
```

**3. Add SentryModule:**

```typescript
// app.module.ts
import { SentryModule } from '@sentry/nestjs/setup';

@Module({
  imports: [SentryModule.forRoot()],
})
export class AppModule {}
```

**4. Global Exception Filter:**

```typescript
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';

providers: [
  {
    provide: APP_FILTER,
    useClass: SentryGlobalFilter,
  },
]
```

### Manual Error Capture

```typescript
import * as Sentry from '@sentry/nestjs';

try {
  await riskyOperation();
} catch (error) {
  Sentry.captureException(error);
  throw error;
}
```

### Performance Monitoring

```typescript
Sentry.startSpan({
  op: 'audio.process',
  name: 'Process Audio File',
}, async () => {
  await this.audioService.process(file);
});
```

---

## Unresolved Questions

1. **Supabase RLS vs Service Role:** Should audio file access use RLS policies or service role key for better performance?
2. **RevenueCat event filtering:** Which specific events are critical for MVP (purchases only vs full lifecycle)?
3. **FCM token management:** Should token refresh be handled via webhooks or polling?
4. **Sentry sampling rates:** What are optimal production values for tracesSampleRate to balance cost vs coverage?
