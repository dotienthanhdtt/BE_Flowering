import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ScenarioChatService } from './services/scenario-chat.service';
import { ScenarioChatRequestDto, ScenarioChatResponseDto } from './dto/scenario-chat.dto';

@ApiTags('Scenario Chat')
@ApiBearerAuth()
@Controller('scenario')
@UseGuards(ThrottlerGuard)
export class ScenarioChatController {
  constructor(private readonly service: ScenarioChatService) {}

  @Post('chat')
  @Throttle({ 'ai-short': { limit: 20, ttl: 60_000 }, 'ai-medium': { limit: 100, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Send a turn in a scenario roleplay conversation' })
  @ApiResponse({ status: 200, type: ScenarioChatResponseDto })
  @ApiResponse({ status: 400, description: 'Conversation completed or invalid body' })
  @ApiResponse({ status: 403, description: 'Premium subscription required' })
  async chat(@Req() req: any, @Body() dto: ScenarioChatRequestDto): Promise<ScenarioChatResponseDto> {
    return this.service.chat(req.user.id, dto);
  }
}
