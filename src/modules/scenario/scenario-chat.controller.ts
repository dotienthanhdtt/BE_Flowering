import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ScenarioChatService } from './services/scenario-chat.service';
import { ActiveLanguage, ActiveLanguageContext } from '../../common/decorators/active-language.decorator';
import {
  ScenarioChatRequestDto,
  ScenarioChatResponseDto,
  ScenarioConversationDetailDto,
  ScenarioConversationListResponseDto,
} from './dto/scenario-chat.dto';

@ApiTags('Scenario Chat')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Learning-Language', description: 'Active learning language code', required: true })
@Controller('scenario')
@UseGuards(ThrottlerGuard)
export class ScenarioChatController {
  constructor(private readonly service: ScenarioChatService) {}

  @Post('chat')
  @Throttle({ 'ai-short': { limit: 20, ttl: 60_000 }, 'ai-medium': { limit: 100, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Send a turn in a scenario roleplay conversation' })
  @ApiResponse({ status: 200, type: ScenarioChatResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Conversation completed, invalid body, or conflicting forceNew+conversationId',
  })
  @ApiResponse({ status: 403, description: 'Premium subscription required' })
  async chat(
    @Req() req: any,
    @ActiveLanguage() lang: ActiveLanguageContext,
    @Body() dto: ScenarioChatRequestDto,
  ): Promise<ScenarioChatResponseDto> {
    return this.service.chat(req.user.id, dto, lang.id);
  }

  // Declared before `/:scenarioId/conversations` so the static `conversations`
  // segment is matched first and not mistaken for a scenarioId path param.
  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get a scenario conversation transcript (owner only)' })
  @ApiResponse({ status: 200, type: ScenarioConversationDetailDto })
  @ApiResponse({ status: 403, description: 'Conversation belongs to another user' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getConversation(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ScenarioConversationDetailDto> {
    return this.service.getConversation(req.user.id, id);
  }

  @Get(':scenarioId/conversations')
  @ApiOperation({ summary: "List the caller's past conversations for a scenario (newest first)" })
  @ApiResponse({ status: 200, type: ScenarioConversationListResponseDto })
  async listConversations(
    @Req() req: any,
    @Param('scenarioId', ParseUUIDPipe) scenarioId: string,
  ): Promise<ScenarioConversationListResponseDto> {
    return this.service.listConversations(req.user.id, scenarioId);
  }
}
