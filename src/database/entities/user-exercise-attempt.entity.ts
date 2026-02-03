import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Exercise } from './exercise.entity';

@Entity('user_exercise_attempts')
export class UserExerciseAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => Exercise, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;

  @Column({ type: 'uuid', name: 'exercise_id' })
  exerciseId!: string;

  @Column({ type: 'jsonb', name: 'user_answer' })
  userAnswer!: Record<string, unknown>;

  @Column({ type: 'boolean', name: 'is_correct' })
  isCorrect!: boolean;

  @Column({ type: 'int', name: 'points_earned', default: 0 })
  pointsEarned!: number;

  @Column({ type: 'int', name: 'time_spent_seconds', nullable: true })
  timeSpentSeconds?: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
