import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HumanMessage } from '@langchain/core/messages';
import { Vocabulary } from '../../../database/entities/vocabulary.entity';
import { AiConversationMessage } from '../../../database/entities/ai-conversation-message.entity';
import { UnifiedLLMService } from './unified-llm.service';
import { PromptLoaderService } from './prompt-loader.service';
import { LLMModel } from '../providers/llm-models.enum';

export interface WordTranslationResult {
  original: string;
  translation: string;
  partOfSpeech?: string;
  pronunciation?: string;
  vocabularyId: string;
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
    userId: string,
    text: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<WordTranslationResult> {
    const prompt = this.promptLoader.loadPrompt('translate-word', {
      word: text,
      sourceLang,
      targetLang,
    });

    const response = await this.llmService.chat([new HumanMessage(prompt)], {
      model: LLMModel.OPENAI_GPT4_1_NANO,
      temperature: 0.1,
    });

    const parsed = this.parseWordResponse(response);

    // Atomic upsert using ON CONFLICT to avoid race conditions
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
      })
      .orUpdate(['translation', 'part_of_speech', 'pronunciation'], [
        'user_id',
        'word',
        'source_lang',
        'target_lang',
      ])
      .returning('id')
      .execute();

    const vocabularyId = result.generatedMaps[0]?.id ?? result.raw[0]?.id;

    return {
      original: text,
      translation: parsed.translation,
      partOfSpeech: parsed.partOfSpeech,
      pronunciation: parsed.pronunciation,
      vocabularyId,
    };
  }

  async translateSentence(
    userId: string,
    messageId: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<SentenceTranslationResult> {
    const message = await this.messageRepo.findOne({
      where: { id: messageId },
      relations: ['conversation'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Verify ownership
    if (message.conversation.userId !== userId) {
      throw new ForbiddenException('You do not own this conversation');
    }

    // Return cached translation if available
    if (message.translatedContent && message.translatedLang === targetLang) {
      return {
        messageId: message.id,
        original: message.content,
        translation: message.translatedContent,
      };
    }

    const prompt = this.promptLoader.loadPrompt('translate-sentence', {
      sentence: message.content,
      sourceLang,
      targetLang,
    });

    const translation = await this.llmService.chat([new HumanMessage(prompt)], {
      model: LLMModel.OPENAI_GPT4_1_NANO,
      temperature: 0.1,
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

  private parseWordResponse(response: string): {
    translation: string;
    partOfSpeech?: string;
    pronunciation?: string;
  } {
    try {
      // Try direct JSON parse first
      const parsed = JSON.parse(response.trim());
      return {
        translation: parsed.translation,
        partOfSpeech: parsed.partOfSpeech,
        pronunciation: parsed.pronunciation,
      };
    } catch {
      // Fallback: extract JSON from response using regex
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            translation: parsed.translation,
            partOfSpeech: parsed.partOfSpeech,
            pronunciation: parsed.pronunciation,
          };
        } catch {
          this.logger.warn(`Failed to parse word translation JSON: ${response}`);
        }
      }
      // Last resort: return raw response as translation
      return { translation: response.trim() };
    }
  }
}
