import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Language } from './language.entity';

@Entity('user_languages')
export class UserLanguage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => Language)
  @JoinColumn({ name: 'language_id' })
  language!: Language;

  @Column({ type: 'uuid', name: 'language_id' })
  languageId!: string;

  @Column({ type: 'varchar', length: 16, name: 'proficiency_level', default: 'A1' })
  proficiencyLevel!: string;

  @Column({ type: 'boolean', name: 'last_learned', default: true })
  lastLearned!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
