import { Controller, Post, Sse, Body, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Observable, Subject } from 'rxjs';
import { LearningAgentService } from './services/learning-agent.service';
import { TranslationService } from './services/translation.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public-route.decorator';
import { RequirePremium } from '../../common/decorators/require-premium.decorator';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { User } from '../../database/entities';
import {
  ChatRequestDto,
  ChatResponseDto,
  CorrectionCheckRequestDto,
  CorrectionCheckResponseDto,
  TranslateRequestDto,
  TranslateType,
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
  ) {}

  @Post('chat')
  @ApiOperation({ summary: 'Chat with AI tutor' })
  @ApiResponse({ status: 200, type: ChatResponseDto })
  async chat(@CurrentUser() user: User, @Body() dto: ChatRequestDto): Promise<ChatResponseDto> {
    return this.learningAgent.chat(user.id, dto.message, dto.context, dto.model);
  }

  @Sse('chat/stream')
  @ApiOperation({ summary: 'Stream chat response (SSE)' })
  streamChat(@CurrentUser() user: User, @Body() dto: ChatRequestDto): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();

    // Start streaming in background
    (async () => {
      try {
        const stream = this.learningAgent.streamChat(user.id, dto.message, dto.context, dto.model);

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

  @Public()
  @RequirePremium(false)
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
    );
  }

  @Public()
  @RequirePremium(false)
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
        dto.sessionToken,
      );
    }
    return this.translationService.translateSentence(
      dto.messageId!,
      dto.sourceLang,
      dto.targetLang,
      userId,
      dto.sessionToken,
    );
  }
}
