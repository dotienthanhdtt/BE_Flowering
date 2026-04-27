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
import { LangfuseFeature } from '../langfuse-feature.enum';

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

export interface ChunkTranslationResult {
  text: string;
  type: string;
  from: number;
  to: number;
  translation: string;
  pronunciation?: string;
  definition?: string;
  examples?: string[];
  vocabularyId?: string;
}

const ALLOWED_CHUNK_TYPES = new Set([
  'word',
  'phrase',
  'idiom',
  'phrasal_verb',
  'compound_noun',
  'particle',
  'article',
  'fixed_expression',
]);

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

    const prompt = this.promptLoader.loadPrompt('translate_phase.md', {
      word: text,
      sourceLang,
      targetLang,
    });

    const response = await this.llmService.chat([new HumanMessage(prompt)], {
      model: LLMModel.OPENAI_GPT4_1_NANO,
      temperature: 0,
      metadata: {
        feature: LangfuseFeature.TRANSLATE_WORD,
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
      temperature: 0,
      metadata: {
        feature: LangfuseFeature.TRANSLATE_SENTENCE,
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

  async translateChunk(
    messageId: string,
    word: string,
    sourceLang: string,
    targetLang: string,
    tapFrom: number,
    tapTo: number,
    userId: string,
  ): Promise<ChunkTranslationResult> {
    if (tapFrom < 0 || tapTo <= tapFrom) {
      throw new BadRequestException('Invalid tap range');
    }
    if (!word || !word.trim()) {
      throw new BadRequestException('word is required');
    }

    const message = await this.messageRepo.findOne({
      where: { id: messageId },
      relations: ['conversation'],
    });
    if (!message) throw new NotFoundException('Message not found');
    this.verifyMessageOwnership(message, userId);

    if (tapTo > message.content.length) {
      throw new BadRequestException('tapTo exceeds message length');
    }

    const prompt = this.promptLoader.loadPrompt('translate_word.md', {
      sentence: message.content,
      word,
      source_lang: sourceLang,
      target_lang: targetLang,
      tap_from: String(tapFrom),
      tap_to: String(tapTo),
    });

    const response = await this.llmService.chat([new HumanMessage(prompt)], {
      model: LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW,
      temperature: 0,
      metadata: {
        feature: LangfuseFeature.TRANSLATE_CHUNK,
        userId,
        messageId,
        conversationId: message.conversationId,
        sourceLang,
        targetLang,
      },
    });

    const parsed = this.parseChunkResponse(response, message.content, tapFrom, tapTo);
    const chunkText = parsed.text.slice(0, 255);

    const result = await this.vocabularyRepo
      .createQueryBuilder()
      .insert()
      .into(Vocabulary)
      .values({
        userId,
        word: chunkText,
        translation: parsed.translation,
        sourceLang,
        targetLang,
        partOfSpeech: parsed.type,
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
      ...parsed,
      text: chunkText,
      vocabularyId: result.generatedMaps[0]?.id ?? result.raw[0]?.id,
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

  private parseChunkResponse(
    raw: string,
    sentence: string,
    tapFrom: number,
    tapTo: number,
  ): Omit<ChunkTranslationResult, 'vocabularyId'> {
    let obj: Record<string, unknown> = {};
    try {
      obj = JSON.parse(raw.trim());
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          obj = JSON.parse(m[0]);
        } catch {
          /* fall through */
        }
      }
    }

    const text = String(obj.text ?? sentence.slice(tapFrom, tapTo));
    const typeRaw = String(obj.type ?? 'word');
    const type = ALLOWED_CHUNK_TYPES.has(typeRaw) ? typeRaw : 'word';
    let from = Number.isInteger(obj.from) ? (obj.from as number) : tapFrom;
    let to = Number.isInteger(obj.to) ? (obj.to as number) : tapTo;
    if (from < 0 || to > sentence.length || from >= to) {
      this.logger.warn(
        `LLM returned invalid range [${from},${to}], clamping to [${tapFrom},${tapTo}]`,
      );
      from = tapFrom;
      to = tapTo;
    }
    const translation = String(obj.translation ?? '').slice(0, 255);
    const pronunciation =
      typeof obj.pronunciation === 'string' && obj.pronunciation.trim()
        ? obj.pronunciation.slice(0, 255)
        : undefined;
    const definition =
      typeof obj.definition === 'string' && obj.definition.trim() ? obj.definition : undefined;
    const examples = Array.isArray(obj.examples)
      ? (obj.examples as unknown[])
          .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
          .slice(0, 2)
      : undefined;

    return { text, type, from, to, translation, pronunciation, definition, examples };
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
