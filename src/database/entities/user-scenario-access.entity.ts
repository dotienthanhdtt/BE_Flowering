import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';
import { Scenario } from './scenario.entity';

@Entity('user_scenario_access')
@Unique(['userId', 'scenarioId'])
export class UserScenarioAccess {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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

  @CreateDateColumn({ name: 'granted_at', type: 'timestamptz' })
  grantedAt!: Date;
}
