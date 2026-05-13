import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AiConversation } from './ai-conversation.entity';
import { User } from './user.entity';
import { Scenario } from './scenario.entity';

@Entity('scenario_evaluations')
export class ScenarioEvaluation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => AiConversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: AiConversation;

  @Column({ type: 'uuid', name: 'conversation_id', unique: true })
  conversationId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => Scenario, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'scenario_id' })
  scenario!: Scenario;

  @Column({ type: 'uuid', name: 'scenario_id' })
  scenarioId!: string;

  @Column({ type: 'smallint', name: 'overall_score', nullable: true })
  overallScore!: number | null;

  @Column({ type: 'smallint', name: 'fluency_score', nullable: true })
  fluencyScore!: number | null;

  @Column({ type: 'smallint', name: 'accuracy_score', nullable: true })
  accuracyScore!: number | null;

  @Column({ type: 'smallint', name: 'vocab_score', nullable: true })
  vocabScore!: number | null;

  @Column('text', { array: true, default: '{}' })
  strengths!: string[];

  @Column('text', { array: true, default: '{}' })
  improvements!: string[];

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'jsonb', name: 'vocab_usage', nullable: true })
  vocabUsage!: Array<{ vocab_id: string; word: string; used: boolean }> | null;

  @Column({ type: 'varchar', length: 64, name: 'model_used', nullable: true })
  modelUsed!: string | null;

  @Column({ type: 'smallint', name: 'prompt_version', default: 1 })
  promptVersion!: number;

  @Column({ type: 'smallint', name: 'error_count', default: 0 })
  errorCount!: number;

  @Column({ type: 'varchar', length: 32, name: 'last_error_code', nullable: true })
  lastErrorCode!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
