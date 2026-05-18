import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Stores RC webhook events that arrived for anonymous (non-UUID) app_user_id values.
 * Persisting the event row lets RC see 200 (stop retrying). Claims are only granted
 * after live RC confirms the entitlement under the authenticated user's UUID.
 */
@Entity('pending_subscription_claims')
@Index('idx_psc_rc_app_user_id_unclaimed', ['rcAppUserId'], {
  where: '"claimed_at" IS NULL',
})
@Index('idx_psc_event_timestamp_created', ['eventTimestampMs', 'createdAt'])
export class PendingSubscriptionClaim {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** RC event ID — unique; ON CONFLICT DO NOTHING makes inserts idempotent. */
  @Column({ type: 'varchar', length: 255, name: 'event_id', unique: true })
  eventId!: string;

  /** The anonymous or non-UUID app_user_id from the RC event. */
  @Column({ type: 'varchar', length: 255, name: 'rc_app_user_id' })
  rcAppUserId!: string;

  @Column({ type: 'varchar', length: 50, name: 'event_type' })
  eventType!: string;

  /** Epoch ms from the RC event; nullable (not all event types include it). */
  @Column({ type: 'bigint', name: 'event_timestamp_ms', nullable: true })
  eventTimestampMs!: number | null;

  /** Raw RC event payload — stored for forensic audit only; never returned to clients. */
  @Column({ type: 'jsonb', name: 'event_payload' })
  eventPayload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** Set when a user successfully claims this pending event. */
  @Column({ type: 'timestamptz', name: 'claimed_at', nullable: true })
  claimedAt?: Date | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'claimed_by_user' })
  claimedByUser?: User | null;

  @Column({ type: 'uuid', name: 'claimed_by_user', nullable: true })
  claimedByUserId?: string | null;
}
