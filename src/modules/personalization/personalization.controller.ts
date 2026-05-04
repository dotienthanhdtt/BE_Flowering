import { Controller, Post, Get, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import {
  ActiveLanguage,
  ActiveLanguageContext,
} from '@/common/decorators/active-language.decorator';
import { User } from '@/database/entities/user.entity';
import { PersonalizationService } from './services/personalization.service';
import { PersonalizeChatDto } from './dto/personalize-chat.dto';
import { PersonalizeCompleteDto } from './dto/personalize-complete.dto';

@ApiTags('personalization')
@ApiBearerAuth()
@Controller('personalization')
export class PersonalizationController {
  constructor(private readonly personalizationService: PersonalizationService) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a chat turn for the personalization intake' })
  async chat(
    @CurrentUser() user: User,
    @ActiveLanguage() lang: ActiveLanguageContext,
    @Body() dto: PersonalizeChatDto,
  ) {
    return this.personalizationService.chat(user.id, lang.id, dto);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete personalization and generate 5 personal scenarios' })
  async complete(
    @CurrentUser() user: User,
    @ActiveLanguage() lang: ActiveLanguageContext,
    @Body() dto: PersonalizeCompleteDto,
  ) {
    const result = await this.personalizationService.complete(user.id, lang.id, dto);

    switch (result.kind) {
      case 'success':
        return {
          scenarios: result.scenarios,
          generatedNew: result.generatedNew,
          ...(result.quotaRemaining !== undefined ? { quotaRemaining: result.quotaRemaining } : {}),
        };
      case 'paywall':
        return {
          code: 0,
          message: 'upgrade_required',
          data: { upsellTo: result.upsellTo, conversationId: result.conversationId },
        };
      case 'daily_ceiling':
        return { code: 0, message: 'daily_limit_reached', data: {} };
    }
  }

  @Get('messages')
  @ApiOperation({ summary: 'List messages for a personalization conversation' })
  async messages(@CurrentUser() user: User, @Query('conversationId') conversationId: string) {
    return this.personalizationService.getMessages(user.id, conversationId);
  }
}
