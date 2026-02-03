import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Lesson } from './lesson.entity';

export enum ExerciseType {
  MULTIPLE_CHOICE = 'multiple_choice',
  FILL_IN_BLANK = 'fill_in_blank',
  LISTENING = 'listening',
  SPEAKING = 'speaking',
  TRANSLATION = 'translation',
  MATCHING = 'matching',
}

@Entity('exercises')
export class Exercise {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Lesson, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lesson_id' })
  lesson!: Lesson;

  @Column({ type: 'uuid', name: 'lesson_id' })
  lessonId!: string;

  @Column({ type: 'enum', enum: ExerciseType })
  type!: ExerciseType;

  @Column({ type: 'text' })
  question!: string;

  @Column({ type: 'jsonb', name: 'correct_answer' })
  correctAnswer!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  options?: Record<string, unknown>;

  @Column({ type: 'text', name: 'audio_url', nullable: true })
  audioUrl?: string;

  @Column({ type: 'int', name: 'order_index', default: 0 })
  orderIndex!: number;

  @Column({ type: 'int', default: 10 })
  points!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
