import {
  Controller,
  Post,
  Put,
  Body,
  Param,
  BadRequestException,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiParam,
} from '@nestjs/swagger';
import { LearningAgentService } from './services/learning-agent.service';
import { TranslationService } from './services/translation.service';
import { TranscriptionService } from './services/transcription.service';
import { MessageCorrectionService } from './services/message-correction.service';
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
  PutCorrectedContentRequestDto,
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
    private messageCorrection: MessageCorrectionService,
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
      dto.messageId,
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

  @SkipLanguageContext()
  @RequirePremium(false)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Put('messages/:messageId/corrected-content')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Persist grammar/vocabulary correction on a user message',
    description:
      'Client orchestration: after parallel /scenario/chat + /ai/chat/correct resolve, ' +
      'call this with the real messageId from the chat response and correctedText from ' +
      'the correct response. Pass null to clear an existing correction.',
  })
  @ApiParam({ name: 'messageId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Correction persisted' })
  @ApiResponse({ status: 403, description: 'Caller does not own the message' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  async putCorrectedContent(
    @CurrentUser() user: User,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @Body() dto: PutCorrectedContentRequestDto,
  ): Promise<void> {
    await this.messageCorrection.persistCorrection(user.id, messageId, dto.correctedText);
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
