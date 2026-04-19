import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Language } from './language.entity';
import { ContentStatus } from './content-status.enum';
import { AccessTier } from './access-tier.enum';

export enum LessonDifficulty {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced',
}

@Entity('lessons')
export class Lesson {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Language)
  @JoinColumn({ name: 'language_id' })
  language!: Language;

  @Column({ type: 'uuid', name: 'language_id' })
  languageId!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({
    type: 'enum',
    enum: LessonDifficulty,
    default: LessonDifficulty.BEGINNER,
  })
  difficulty!: LessonDifficulty;

  @Column({ type: 'int', name: 'order_index', default: 0 })
  orderIndex!: number;

  @Column({ type: 'enum', enum: AccessTier, default: AccessTier.FREE, name: 'access_tier' })
  accessTier!: AccessTier;

  @Column({ type: 'enum', enum: ContentStatus, default: ContentStatus.PUBLISHED })
  status!: ContentStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
