import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public-route.decorator';
import { OnboardingService } from './onboarding.service';
import { OnboardingChatDto, OnboardingCompleteDto } from './dto';
import { OnboardingThrottlerGuard } from './onboarding-throttler.guard';

@ApiTags('onboarding')
@Controller('onboarding')
@UseGuards(OnboardingThrottlerGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Public()
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start or continue onboarding chat' })
  @ApiBody({
    type: OnboardingChatDto,
    examples: {
      newSession: {
        summary: 'New session (no conversationId)',
        value: { nativeLanguage: 'vi', targetLanguage: 'en' },
      },
      continueSession: {
        summary: 'Continue session',
        value: { conversationId: '550e8400-e29b-41d4-a716-446655440000', message: 'hello' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'AI reply with conversation state',
    schema: {
      example: {
        code: 1,
        message: 'Success',
        data: {
          conversationId: '550e8400-e29b-41d4-a716-446655440000',
          reply: 'Hello! Welcome to your language learning journey.',
          messageId: 'msg-uuid',
          turnNumber: 1,
          isLastTurn: false,
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error or max turns reached' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async chat(@Body() dto: OnboardingChatDto) {
    return this.onboardingService.handleChat(dto);
  }

  @Public()
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Extract structured onboarding profile from conversation' })
  @ApiResponse({ status: 200, description: 'Extracted user profile data' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async complete(@Body() dto: OnboardingCompleteDto) {
    return this.onboardingService.complete(dto);
  }
}
