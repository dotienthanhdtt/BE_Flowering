import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ScenarioChatService } from './services/scenario-chat.service';
import {
  ActiveLanguage,
  ActiveLanguageContext,
} from '../../common/decorators/active-language.decorator';
import { ResourceAccessGuard } from '@common/guards/resource-access.guard';
import { RequireResourceAccess } from '@common/decorators/require-resource-access.decorator';
import { ScenarioChatRequestDto, ScenarioChatResponseDto } from './dto/scenario-chat.dto';

interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

@ApiTags('Scenario Chat')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Learning-Language',
  description: 'Active learning language code',
  required: true,
})
@Controller('scenario')
@UseGuards(ThrottlerGuard)
export class ScenarioChatController {
  constructor(private readonly service: ScenarioChatService) {}

  @Post('chat')
  @Throttle({ 'ai-short': { limit: 20, ttl: 60_000 }, 'ai-medium': { limit: 100, ttl: 3_600_000 } })
  @UseGuards(ResourceAccessGuard)
  @RequireResourceAccess({ resource: 'scenario', bodyKey: 'scenarioId' })
  @ApiOperation({ summary: 'Send a turn in a scenario roleplay conversation' })
  @ApiResponse({ status: 200, type: ScenarioChatResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Conversation completed or invalid body',
  })
  @ApiResponse({ status: 403, description: 'Premium subscription required' })
  async chat(
    @Req() req: AuthenticatedRequest,
    @ActiveLanguage() lang: ActiveLanguageContext,
    @Body() dto: ScenarioChatRequestDto,
  ): Promise<ScenarioChatResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.service.chat(req.user!.id, dto, lang.id);
  }
}
