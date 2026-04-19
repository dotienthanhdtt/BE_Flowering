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
import { Language } from './language.entity';
import { Scenario } from './scenario.entity';

export enum AiConversationType {
  ANONYMOUS = 'anonymous',
  AUTHENTICATED = 'authenticated',
}

@Entity('ai_conversations')
export class AiConversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user?: User | null;

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId?: string | null;

  @ManyToOne(() => Language)
  @JoinColumn({ name: 'language_id' })
  language!: Language;

  @Column({ type: 'uuid', name: 'language_id' })
  languageId!: string;

  @Column({
    type: 'enum',
    enum: AiConversationType,
    default: AiConversationType.AUTHENTICATED,
  })
  type!: AiConversationType;

  @Column({ type: 'timestamptz', name: 'expires_at', nullable: true })
  expiresAt?: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  topic?: string;

  @Column({ type: 'int', name: 'message_count', default: 0 })
  messageCount!: number;

  @ManyToOne(() => Scenario, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'scenario_id' })
  scenario?: Scenario;

  @Column({ type: 'uuid', name: 'scenario_id', nullable: true })
  scenarioId?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  // Cached learner profile extracted by `POST /onboarding/complete` for idempotency.
  @Column({ type: 'jsonb', name: 'extracted_profile', nullable: true })
  extractedProfile?: Record<string, unknown> | null;

  // Cached 5-scenario payload (full OnboardingScenarioDto shape) for stable UUIDs across resumes.
  @Column({ type: 'jsonb', nullable: true })
  scenarios?: Array<Record<string, unknown>> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
