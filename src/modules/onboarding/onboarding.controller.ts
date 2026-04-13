import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public-route.decorator';
import { OnboardingService } from './onboarding.service';
import { StartOnboardingDto, OnboardingChatDto, OnboardingCompleteDto } from './dto';

@ApiTags('onboarding')
@Controller('onboarding')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 30, ttl: 3600_000 } })
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  @Post('start')
  @ApiOperation({ summary: 'Start anonymous onboarding chat session' })
  @ApiResponse({ status: 201, description: 'Session created with conversation_id' })
  async start(@Body() dto: StartOnboardingDto) {
    return this.onboardingService.startSession(dto);
  }

  @Public()
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send message in onboarding chat' })
  @ApiResponse({ status: 200, description: 'AI reply with turn info' })
  @ApiResponse({ status: 400, description: 'Max turns reached or session expired' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async chat(@Body() dto: OnboardingChatDto) {
    return this.onboardingService.chat(dto);
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
