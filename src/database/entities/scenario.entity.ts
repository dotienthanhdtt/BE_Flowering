import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ScenarioCategory } from './scenario-category.entity';
import { Language } from './language.entity';
import { User } from './user.entity';
import { AiConversation } from './ai-conversation.entity';
import { ContentStatus } from './content-status.enum';
import { AccessTier } from './access-tier.enum';
import { ScenarioType } from './scenario-type.enum';

export enum ScenarioDifficulty {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced',
}

@Entity('scenarios')
export class Scenario {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => ScenarioCategory, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category?: ScenarioCategory;

  @Column({ type: 'uuid', name: 'category_id', nullable: true })
  categoryId?: string;

  @ManyToOne(() => Language)
  @JoinColumn({ name: 'language_id' })
  language!: Language;

  @Column({ type: 'uuid', name: 'language_id' })
  languageId!: string;

  /** KOL/KOC creator — nullable, reserved for future use */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'creator_id' })
  creator?: User;

  @Column({ type: 'uuid', name: 'creator_id', nullable: true })
  creatorId?: string;

  /** Personal scenario owner. NULL for system/kol rows. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner?: User;

  @Column({ type: 'uuid', name: 'owner_id', nullable: true })
  ownerId?: string;

  /** AI conversation that produced this scenario (personal only). */
  @ManyToOne(() => AiConversation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_conversation_id' })
  sourceConversation?: AiConversation;

  @Column({ type: 'uuid', name: 'source_conversation_id', nullable: true })
  sourceConversationId?: string;

  @Column({ type: 'enum', enum: ScenarioType, default: ScenarioType.SYSTEM })
  type!: ScenarioType;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', name: 'image_url', nullable: true })
  imageUrl?: string;

  @Column({
    type: 'enum',
    enum: ScenarioDifficulty,
    default: ScenarioDifficulty.BEGINNER,
  })
  difficulty!: ScenarioDifficulty;

  @Column({ type: 'enum', enum: AccessTier, default: AccessTier.FREE, name: 'access_tier' })
  accessTier!: AccessTier;

  @Column({ type: 'enum', enum: ContentStatus, default: ContentStatus.PUBLISHED })
  status!: ContentStatus;

  @Column({ type: 'int', name: 'order_index', default: 0 })
  orderIndex!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
