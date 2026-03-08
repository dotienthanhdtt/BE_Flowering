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

@Entity('vocabulary')
@Unique(['userId', 'word', 'sourceLang', 'targetLang'])
export class Vocabulary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  word!: string;

  @Column({ type: 'varchar', length: 255 })
  translation!: string;

  @Column({ type: 'varchar', length: 10, name: 'source_lang' })
  sourceLang!: string;

  @Column({ type: 'varchar', length: 10, name: 'target_lang' })
  targetLang!: string;

  @Column({ type: 'varchar', length: 50, name: 'part_of_speech', nullable: true })
  partOfSpeech?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  pronunciation?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
