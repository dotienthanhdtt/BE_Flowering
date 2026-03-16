import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Stores processed webhook event IDs for idempotency.
 * Prevents duplicate webhook processing across server restarts.
 */
@Entity('webhook_events')
export class WebhookEvent {
  @PrimaryColumn({ type: 'varchar', length: 255, name: 'event_id' })
  eventId!: string;

  @Column({ type: 'varchar', length: 50, name: 'event_type' })
  eventType!: string;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt!: Date;
}
