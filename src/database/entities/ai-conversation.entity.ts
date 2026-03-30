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

  @ManyToOne(() => Language, { nullable: true })
  @JoinColumn({ name: 'language_id' })
  language?: Language | null;

  @Column({ type: 'uuid', name: 'language_id', nullable: true })
  languageId?: string | null;

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

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
