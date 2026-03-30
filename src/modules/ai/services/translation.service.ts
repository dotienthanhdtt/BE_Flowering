import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HumanMessage } from '@langchain/core/messages';
import { Vocabulary } from '../../../database/entities/vocabulary.entity';
import { AiConversationMessage } from '../../../database/entities/ai-conversation-message.entity';
import {
  AiConversation,
  AiConversationType,
} from '../../../database/entities/ai-conversation.entity';
import { UnifiedLLMService } from './unified-llm.service';
import { PromptLoaderService } from './prompt-loader.service';
import { LLMModel } from '../providers/llm-models.enum';

export interface WordTranslationResult {
  original: string;
  translation: string;
  partOfSpeech?: string;
  pronunciation?: string;
  definition?: string;
  examples?: string[];
  vocabularyId?: string;
}

export interface SentenceTranslationResult {
  messageId: string;
  original: string;
  translation: string;
}

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(
    @InjectRepository(Vocabulary)
    private vocabularyRepo: Repository<Vocabulary>,
    @InjectRepository(AiConversationMessage)
    private messageRepo: Repository<AiConversationMessage>,
    private llmService: UnifiedLLMService,
    private promptLoader: PromptLoaderService,
  ) {}

  async translateWord(
    text: string,
    sourceLang: string,
    targetLang: string,
    userId: string | null,
    conversationId?: string,
  ): Promise<WordTranslationResult> {
    if (!userId && !conversationId) {
      throw new BadRequestException('Authentication or conversationId required');
    }

    const prompt = this.promptLoader.loadPrompt('translate-word.md', {
      word: text,
      sourceLang,
      targetLang,
    });

    const response = await this.llmService.chat([new HumanMessage(prompt)], {
      model: LLMModel.OPENAI_GPT4_1_NANO,
      temperature: 0.1,
      metadata: {
        feature: 'translate-word',
        userId: userId ?? conversationId,
        conversationId,
        sourceLang,
        targetLang,
      },
    });

    const parsed = this.parseWordResponse(response);

    // Anonymous users: return translation only, no vocabulary save
    if (!userId) {
      return { original: text, ...parsed };
    }

    // Authenticated users: upsert to vocabulary
    const result = await this.vocabularyRepo
      .createQueryBuilder()
      .insert()
      .into(Vocabulary)
      .values({
        userId,
        word: text,
        translation: parsed.translation,
        sourceLang,
        targetLang,
        partOfSpeech: parsed.partOfSpeech,
        pronunciation: parsed.pronunciation,
        definition: parsed.definition,
        examples: parsed.examples,
      })
      .orUpdate(
        ['translation', 'part_of_speech', 'pronunciation', 'definition', 'examples'],
        ['user_id', 'word', 'source_lang', 'target_lang'],
      )
      .returning('id')
      .execute();

    return {
      original: text,
      ...parsed,
      vocabularyId: result.generatedMaps[0]?.id ?? result.raw[0]?.id,
    };
  }

  async translateSentence(
    messageId: string,
    sourceLang: string,
    targetLang: string,
    userId: string | null,
    conversationId?: string,
  ): Promise<SentenceTranslationResult> {
    if (!userId && !conversationId) {
      throw new BadRequestException('Authentication or conversationId required');
    }

    const message = await this.messageRepo.findOne({
      where: { id: messageId },
      relations: ['conversation'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    this.verifyMessageOwnership(message, userId, conversationId);

    // Return cached translation if available
    if (message.translatedContent && message.translatedLang === targetLang) {
      return {
        messageId: message.id,
        original: message.content,
        translation: message.translatedContent,
      };
    }

    const prompt = this.promptLoader.loadPrompt('translate-sentence.md', {
      sentence: message.content,
      sourceLang,
      targetLang,
    });

    const translation = await this.llmService.chat([new HumanMessage(prompt)], {
      model: LLMModel.OPENAI_GPT4_1_NANO,
      temperature: 0.1,
      metadata: {
        feature: 'translate-sentence',
        userId: userId ?? conversationId,
        conversationId: message.conversationId,
        messageId,
        sourceLang,
        targetLang,
      },
    });

    // Cache translation on message
    message.translatedContent = translation.trim();
    message.translatedLang = targetLang;
    await this.messageRepo.save(message);

    return {
      messageId: message.id,
      original: message.content,
      translation: message.translatedContent,
    };
  }

  /** Verify the caller owns the message's conversation via userId or conversationId */
  private verifyMessageOwnership(
    message: AiConversationMessage & { conversation: AiConversation },
    userId: string | null,
    conversationId?: string,
  ): void {
    if (userId && message.conversation.userId === userId) return;
    if (
      conversationId &&
      message.conversation.id === conversationId &&
      message.conversation.type === AiConversationType.ANONYMOUS
    )
      return;
    throw new ForbiddenException('You do not own this conversation');
  }

  private parseWordResponse(response: string): ReturnType<typeof this.extractWordFields> {
    try {
      return this.extractWordFields(JSON.parse(response.trim()));
    } catch {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return this.extractWordFields(JSON.parse(jsonMatch[0]));
        } catch {
          this.logger.warn(`Failed to parse word translation JSON: ${response}`);
        }
      }
      return this.extractWordFields({ translation: response.trim() });
    }
  }

  private extractWordFields(parsed: Record<string, unknown>) {
    return {
      translation: parsed.translation as string,
      partOfSpeech: parsed.partOfSpeech as string | undefined,
      pronunciation: parsed.pronunciation as string | undefined,
      definition: parsed.definition as string | undefined,
      examples: Array.isArray(parsed.examples)
        ? (parsed.examples as string[]).slice(0, 2)
        : undefined,
    };
  }
}
