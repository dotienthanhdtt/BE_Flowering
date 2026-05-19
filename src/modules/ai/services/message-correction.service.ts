import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConversationMessage } from '../../../database/entities/ai-conversation-message.entity';

/**
 * Persists grammar/vocabulary correction text on a user message row.
 * Separate from LearningAgentService (LLM-heavy) — this service is DB-only.
 */
@Injectable()
export class MessageCorrectionService {
  constructor(
    @InjectRepository(AiConversationMessage)
    private readonly messageRepo: Repository<AiConversationMessage>,
  ) {}

  /**
   * Update `corrected_content` for a message owned by `userId`.
   * Single QB join verifies ownership via the parent conversation.
   */
  async persistCorrection(
    userId: string,
    messageId: string,
    correctedText: string | null,
  ): Promise<void> {
    const row = await this.messageRepo
      .createQueryBuilder('m')
      .leftJoin('m.conversation', 'c')
      .select(['m.id AS m_id', 'c.user_id AS c_user_id'])
      .where('m.id = :messageId', { messageId })
      .getRawOne<{ m_id: string; c_user_id: string | null }>();

    if (!row) throw new NotFoundException('Message not found');
    if (row.c_user_id !== userId) throw new ForbiddenException();

    await this.messageRepo.update({ id: messageId }, { correctedContent: correctedText });
  }
}
