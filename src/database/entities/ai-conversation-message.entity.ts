import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AiConversation } from './ai-conversation.entity';

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

@Entity('ai_conversation_messages')
export class AiConversationMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => AiConversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: AiConversation;

  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId!: string;

  @Column({ type: 'enum', enum: MessageRole })
  role!: MessageRole;

  @Column({ type: 'text' })
  content!: string;

  // Object-storage key (NOT a URL) for the message's audio asset:
  //   - user-role rows: STT recording uploaded after the WS session ends
  //   - assistant-role rows: TTS-synthesized mp3
  // Signed URLs are minted on read via ObjectStorageService.getSignedUrl(path)
  // so cache hits never return expired signatures. Column name retained for
  // backwards compat with existing schema.
  @Column({ type: 'text', name: 'audio_url', nullable: true })
  audioUrl?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ type: 'text', name: 'translated_content', nullable: true })
  translatedContent?: string;

  @Column({ type: 'varchar', length: 10, name: 'translated_lang', nullable: true })
  translatedLang?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
