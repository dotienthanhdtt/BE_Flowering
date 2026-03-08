import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  Sse,
  UseInterceptors,
  UseGuards,
  UploadedFile,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { Observable, Subject } from 'rxjs';
import { LearningAgentService } from './services/learning-agent.service';
import { WhisperTranscriptionService } from './services/whisper-transcription.service';
import { TranslationService } from './services/translation.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../../common/decorators/optional-auth.decorator';
import { User } from '../../database/entities';
import {
  ChatRequestDto,
  ChatResponseDto,
  CreateConversationDto,
  GrammarCheckRequestDto,
  GrammarCheckResult,
  CorrectionCheckRequestDto,
  CorrectionCheckResponseDto,
  GenerateExerciseRequestDto,
  ExerciseResult,
  PronunciationAssessmentRequestDto,
  PronunciationResult,
  TranslateRequestDto,
  TranslateType,
} from './dto';

// Max audio file size: 10MB
const MAX_AUDIO_SIZE = 10 * 1024 * 1024;

/**
 * AI Controller for language learning features.
 * All endpoints require authentication (global JWT guard).
 * Rate limiting applied via ThrottlerGuard.
 */
@ApiTags('ai')
@ApiBearerAuth('JWT-auth')
@Controller('ai')
@UseGuards(ThrottlerGuard)
export class AiController {
  constructor(
    private learningAgent: LearningAgentService,
    private whisperService: WhisperTranscriptionService,
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

  @Post('grammar/check')
  @ApiOperation({ summary: 'Check text grammar' })
  @ApiResponse({ status: 200, type: GrammarCheckResult })
  async checkGrammar(@Body() dto: GrammarCheckRequestDto): Promise<GrammarCheckResult> {
    return this.learningAgent.checkGrammar(dto.text, dto.targetLanguage, dto.model);
  }

  @Post('chat/correct')
  @OptionalAuth()
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

  @Post('exercises/generate')
  @ApiOperation({ summary: 'Generate a language exercise' })
  @ApiResponse({ status: 200, type: ExerciseResult })
  async generateExercise(@Body() dto: GenerateExerciseRequestDto): Promise<ExerciseResult> {
    return this.learningAgent.generateExercise(
      dto.exerciseType,
      dto.targetLanguage,
      dto.proficiencyLevel,
      dto.topic,
      dto.model,
    );
  }

  @Post('pronunciation/assess')
  @ApiOperation({ summary: 'Assess pronunciation from audio' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        audio: { type: 'string', format: 'binary' },
        expectedText: { type: 'string' },
        targetLanguage: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 200, type: PronunciationResult })
  @UseInterceptors(FileInterceptor('audio'))
  async assessPronunciation(
    @UploadedFile() audio: Express.Multer.File,
    @Body() dto: PronunciationAssessmentRequestDto,
  ): Promise<PronunciationResult> {
    // Validate audio file
    if (!audio) {
      throw new BadRequestException('Audio file is required');
    }
    if (audio.size > MAX_AUDIO_SIZE) {
      throw new BadRequestException('Audio file exceeds maximum size of 10MB');
    }
    if (!audio.mimetype.startsWith('audio/')) {
      throw new BadRequestException('Invalid audio file type');
    }

    // Transcribe audio using Whisper
    const transcribedText = await this.whisperService.transcribe(audio.buffer, dto.targetLanguage);

    // Assess pronunciation using LLM
    const result = await this.learningAgent.assessPronunciation(
      transcribedText,
      dto.expectedText,
      dto.targetLanguage,
      dto.model,
    );

    // Include transcribed text in response
    return { ...result, transcribedText };
  }

  @Post('translate')
  @OptionalAuth()
  @ApiOperation({ summary: 'Translate a word or sentence (JWT or sessionToken)' })
  @ApiResponse({ status: 200, description: 'Translation result' })
  async translate(@Req() req: Request, @Body() dto: TranslateRequestDto) {
    const user = req.user as User | null;
    const userId = user?.id ?? null;

    if (dto.type === TranslateType.WORD) {
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

  @Post('conversations')
  @ApiOperation({ summary: 'Start a new conversation session' })
  async createConversation(
    @CurrentUser() user: User,
    @Body() dto: CreateConversationDto,
  ): Promise<{ id: string }> {
    const conversation = await this.learningAgent.createConversation(user.id, dto);
    return { id: conversation.id };
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get conversation message history' })
  async getConversationMessages(
    @Param('id', ParseUUIDPipe) conversationId: string,
  ): Promise<{ messages: unknown[] }> {
    const messages = await this.learningAgent.getConversationMessages(conversationId);
    return { messages };
  }
}
