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
import { ContentStatus } from './content-status.enum';

export enum ScenarioDifficulty {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced',
}

@Entity('scenarios')
export class Scenario {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => ScenarioCategory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category!: ScenarioCategory;

  @Column({ type: 'uuid', name: 'category_id' })
  categoryId!: string;

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

  /** Gift link code — nullable, reserved for future use */
  @Column({ type: 'varchar', length: 50, name: 'gift_code', nullable: true, unique: true })
  giftCode?: string;

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

  @Column({ type: 'boolean', name: 'is_premium', default: false })
  isPremium!: boolean;

  @Column({ type: 'boolean', name: 'is_trial', default: false })
  isTrial!: boolean;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ type: 'enum', enum: ContentStatus, default: ContentStatus.PUBLISHED })
  status!: ContentStatus;

  @Column({ type: 'int', name: 'order_index', default: 0 })
  orderIndex!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
