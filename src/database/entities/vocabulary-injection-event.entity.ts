import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AiConversation } from './ai-conversation.entity';
import { Vocabulary } from './vocabulary.entity';

@Entity('vocabulary_injection_events')
export class VocabularyInjectionEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => AiConversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: AiConversation;

  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId!: string;

  @ManyToOne(() => Vocabulary, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vocabulary_id' })
  vocabulary!: Vocabulary;

  @Column({ type: 'uuid', name: 'vocabulary_id' })
  vocabularyId!: string;

  @Column({ type: 'smallint', name: 'turn_index' })
  turnIndex!: number;

  @Column({ type: 'boolean', name: 'was_used', default: false })
  wasUsed!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
