import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import {
  ActiveLanguage,
  ActiveLanguageContext,
  AutoEnrollLanguage,
  SkipLanguageContext,
} from '@common/decorators/active-language.decorator';
import { ListScenariosQueryDto } from './dto/list-scenarios-query.dto';
import { RedeemScenarioDto } from './dto/redeem-scenario.dto';
import { ScenariosListingService } from './services/scenarios-listing.service';
import { ScenariosRedeemService } from './services/scenarios-redeem.service';

@ApiTags('scenarios')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Learning-Language', required: false })
@Controller('scenarios')
export class ScenariosController {
  constructor(
    private readonly listingService: ScenariosListingService,
    private readonly redeemService: ScenariosRedeemService,
  ) {}

  @Get('default')
  @AutoEnrollLanguage()
  @ApiOperation({ summary: 'List default scenarios for active language' })
  @ApiResponse({ status: 200 })
  listDefault(
    @ActiveLanguage() lang: ActiveLanguageContext,
    @Query() query: ListScenariosQueryDto,
  ) {
    return this.listingService.listDefault(lang.id, query.page, query.limit);
  }

  @Get('personal')
  @AutoEnrollLanguage()
  @ApiOperation({ summary: 'List personalized + KOL-granted scenarios' })
  @ApiResponse({ status: 200 })
  listPersonal(
    @CurrentUser() user: { id: string },
    @ActiveLanguage() lang: ActiveLanguageContext,
    @Query() query: ListScenariosQueryDto,
  ) {
    return this.listingService.listPersonal(user.id, lang.id, query.page, query.limit);
  }

  @Post('redeem')
  @SkipLanguageContext()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Redeem a KOL gift code' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Gift code not found' })
  redeem(@CurrentUser() user: { id: string }, @Body() dto: RedeemScenarioDto) {
    return this.redeemService.redeem(user.id, dto.giftCode);
  }
}
