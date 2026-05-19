import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public-route.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { User } from '../../../database/entities';
import { TtsService } from './tts.service';
import { TtsOnboardingRequestDto, TtsRequestDto } from './dto/tts-request.dto';

@ApiTags('ai-speech-tts')
@Controller('ai/speech/tts')
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Synthesize assistant message to mp3 (scenario chat)' })
  @ApiBody({ type: TtsRequestDto })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        code: 1,
        message: 'Success',
        data: { audioUrl: 'https://...signed-mp3', mimeType: 'audio/mpeg', cached: false },
      },
    },
  })
  async synthesizeScenario(@CurrentUser() user: User, @Body() dto: TtsRequestDto) {
    return this.tts.synthesizeMessage(dto.messageId, {
      kind: 'scenario',
      userId: user.id,
      traceId: dto.traceId,
    });
  }

  @Public()
  @Post('onboarding')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Synthesize assistant message to mp3 (onboarding flow, no JWT)' })
  @ApiBody({ type: TtsOnboardingRequestDto })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        code: 1,
        message: 'Success',
        data: { audioUrl: 'https://...signed-mp3', mimeType: 'audio/mpeg', cached: false },
      },
    },
  })
  async synthesizeOnboarding(@Body() dto: TtsOnboardingRequestDto) {
    return this.tts.synthesizeMessage(dto.messageId, {
      kind: 'onboarding',
      sessionId: dto.sessionId,
      conversationId: dto.conversationId,
      traceId: dto.traceId,
    });
  }
}
