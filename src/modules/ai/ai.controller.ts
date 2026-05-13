import {
  Controller,
  Post,
  Body,
  BadRequestException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { LearningAgentService } from './services/learning-agent.service';
import { TranslationService } from './services/translation.service';
import { TranscriptionService } from './services/transcription.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../../common/decorators/optional-auth.decorator';
import { RequirePremium } from '../../common/decorators/require-premium.decorator';
import { SkipLanguageContext } from '../../common/decorators/active-language.decorator';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { User } from '../../database/entities';
import {
  CorrectionCheckRequestDto,
  CorrectionCheckResponseDto,
  TranslateRequestDto,
  TranslateType,
  TranscribeResponseDto,
  TranslateChunkRequestDto,
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
      if (!dto.text) {
        throw new BadRequestException('text is required for word translation');
      }
      return this.translationService.translateWord(
        dto.text,
        dto.sourceLang,
        dto.targetLang,
        userId,
        dto.conversationId,
      );
    }
    if (!dto.messageId) {
      throw new BadRequestException('messageId is required for sentence translation');
    }
    return this.translationService.translateSentence(
      dto.messageId,
      dto.sourceLang,
      dto.targetLang,
      userId,
      dto.conversationId,
    );
  }

  @SkipLanguageContext()
  @RequirePremium(false)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('translate/word')
  @ApiOperation({ summary: 'Translate a context-aware chunk in a sentence' })
  @ApiResponse({ status: 200, description: 'Chunk translation result' })
  async translateChunk(@CurrentUser() user: User, @Body() dto: TranslateChunkRequestDto) {
    return this.translationService.translateChunk(
      dto.messageId,
      dto.word,
      dto.sourceLang,
      dto.targetLang,
      dto.tapFrom,
      dto.tapTo,
      user.id,
    );
  }

  @Post('transcribe')
  @ApiOperation({ summary: 'Transcribe audio to text' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, type: TranscribeResponseDto })
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB hard limit at Multer layer
    }),
  )
  async transcribe(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<TranscribeResponseDto> {
    const result = await this.transcriptionService.transcribe(file, user.id);
    return { text: result.text };
  }
}
