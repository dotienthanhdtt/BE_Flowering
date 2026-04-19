import { Controller, Post, Sse, Body, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { Observable, Subject } from 'rxjs';
import { LearningAgentService } from './services/learning-agent.service';
import { TranslationService } from './services/translation.service';
import { TranscriptionService } from './services/transcription.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../../common/decorators/optional-auth.decorator';
import { RequirePremium } from '../../common/decorators/require-premium.decorator';
import { ActiveLanguage, ActiveLanguageContext, SkipLanguageContext } from '../../common/decorators/active-language.decorator';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { User } from '../../database/entities';
import {
  ChatRequestDto,
  ChatResponseDto,
  CorrectionCheckRequestDto,
  CorrectionCheckResponseDto,
  TranslateRequestDto,
  TranslateType,
  TranscribeResponseDto,
} from './dto';

/**
 * AI Controller for language learning features.
 * All endpoints require authentication (global JWT guard).
 * Rate limiting applied via ThrottlerGuard.
 */
@ApiTags('ai')
@ApiBearerAuth('JWT-auth')
@Controller('ai')
@UseGuards(ThrottlerGuard, PremiumGuard)
@RequirePremium()
export class AiController {
  constructor(
    private learningAgent: LearningAgentService,
    private translationService: TranslationService,
    private transcriptionService: TranscriptionService,
  ) {}

  @Post('chat')
  @ApiOperation({ summary: 'Chat with AI tutor' })
  @ApiResponse({ status: 200, type: ChatResponseDto })
  async chat(
    @CurrentUser() user: User,
    @ActiveLanguage() lang: ActiveLanguageContext,
    @Body() dto: ChatRequestDto,
  ): Promise<ChatResponseDto> {
    const context = { ...dto.context, targetLanguage: lang.code };
    return this.learningAgent.chat(user.id, dto.message, context, dto.model);
  }

  @Sse('chat/stream')
  @ApiOperation({ summary: 'Stream chat response (SSE)' })
  streamChat(
    @CurrentUser() user: User,
    @ActiveLanguage() lang: ActiveLanguageContext,
    @Body() dto: ChatRequestDto,
  ): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    const context = { ...dto.context, targetLanguage: lang.code };

    // Start streaming in background
    (async () => {
      try {
        const stream = this.learningAgent.streamChat(user.id, dto.message, context, dto.model);

        for await (const chunk of stream) {
          subject.next({ data: { content: chunk } } as MessageEvent);
        }
        subject.complete();
      } catch (error) {
        subject.error(error);
      }
    })();

    return subject.asObservable();
  }

  @OptionalAuth()
  @SkipLanguageContext()
  @RequirePremium(false)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('chat/correct')
  @ApiOperation({ summary: 'Check grammar/vocabulary of user chat reply' })
  @ApiResponse({ status: 200, type: CorrectionCheckResponseDto })
  async checkCorrection(
    @Body() dto: CorrectionCheckRequestDto,
  ): Promise<CorrectionCheckResponseDto> {
    return this.learningAgent.checkCorrection(
      dto.previousAiMessage,
      dto.userMessage,
      dto.targetLanguage,
      dto.conversationId,
    );
  }

  @OptionalAuth()
  @SkipLanguageContext()
  @RequirePremium(false)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('translate')
  @ApiOperation({ summary: 'Translate a word or sentence' })
  @ApiResponse({ status: 200, description: 'Translation result' })
  async translate(@CurrentUser() user: User | null, @Body() dto: TranslateRequestDto) {
    const userId = user?.id ?? null;

    if (dto.type.toLowerCase() === TranslateType.WORD) {
      return this.translationService.translateWord(
        dto.text!,
        dto.sourceLang,
        dto.targetLang,
        userId,
        dto.conversationId,
      );
    }
    return this.translationService.translateSentence(
      dto.messageId!,
      dto.sourceLang,
      dto.targetLang,
      userId,
      dto.conversationId,
    );
  }

  @Post('transcribe')
  @ApiOperation({ summary: 'Transcribe audio to text' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, type: TranscribeResponseDto })
  @UseInterceptors(FileInterceptor('audio', {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB hard limit at Multer layer
  }))
  async transcribe(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<TranscribeResponseDto> {
    const result = await this.transcriptionService.transcribe(file, user.id);
    return { text: result.text };
  }
}
