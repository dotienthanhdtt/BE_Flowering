# Phase 1: Webhook Event Entity + Migration

**Priority:** High (blocks Phase 2)
**Status:** **COMPLETE**
**Context:** [brainstorm](../reports/brainstorm-260314-1335-subscription-payment-features.md) § Priority 3

---

## Overview

Create `WebhookEvent` TypeORM entity and Supabase migration for persistent webhook deduplication.

## Key Insights

- Current idempotency uses in-memory `Set<string>` in `SubscriptionService` — lost on restart
- RevenueCat sends event IDs that are unique per webhook delivery
- Simple table with `event_id` as natural PK — no UUID generation needed

## Requirements

- `webhook_events` table with: `event_id` (PK), `event_type`, `processed_at`
- TypeORM entity registered in both `database.module.ts` and `subscription.module.ts`
- Migration with proper up/down methods

## Related Code Files

**Create:**
- `src/database/entities/webhook-event.entity.ts`
- `src/database/migrations/{timestamp}-create-webhook-events-table.ts`

**Modify:**
- `src/database/entities/index.ts` — export new entity
- `src/database/database.module.ts` — add to global entities array
- `src/modules/subscription/subscription.module.ts` — add to `TypeOrmModule.forFeature([])`

## Implementation Steps

1. Create `webhook-event.entity.ts`:
   ```typescript
   @Entity('webhook_events')
   export class WebhookEvent {
     @PrimaryColumn({ type: 'varchar', length: 255 })
     eventId: string;

     @Column({ type: 'varchar', length: 50 })
     eventType: string;

     @CreateDateColumn({ type: 'timestamptz' })
     processedAt: Date;
   }
   ```

2. Export from `src/database/entities/index.ts`

3. Register in `database.module.ts` global entities array

4. Add to `subscription.module.ts` `TypeOrmModule.forFeature([Subscription, User, WebhookEvent])`

5. Create migration file:
   ```sql
   CREATE TABLE webhook_events (
     event_id VARCHAR(255) PRIMARY KEY,
     event_type VARCHAR(50) NOT NULL,
     processed_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```

6. Run `npm run build` to verify compilation

## Todo

- [x] Create webhook-event.entity.ts
- [x] Export from entities/index.ts
- [x] Register in database.module.ts
- [x] Register in subscription.module.ts
- [x] Create migration file
- [x] Verify build passes

## Success Criteria

- Entity compiles and is registered in both locations
- Migration runs without errors
- `npm run build` passes

## Risk Assessment

- **Low risk** — independent table, no FK constraints, no existing data affected
- Migration is additive only (CREATE TABLE)
