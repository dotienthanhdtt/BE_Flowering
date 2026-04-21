import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import {
  ActiveLanguage,
  ActiveLanguageContext,
  AutoEnrollLanguage,
  SkipLanguageContext,
} from '@common/decorators/active-language.decorator';
import { ListScenariosQueryDto } from './dto/list-scenarios-query.dto';
import { ScenarioDefaultDto } from './dto/scenario-default.dto';
import { ScenarioPersonalDto } from './dto/scenario-personal.dto';
import { RedeemScenarioDto, RedeemResponseDto } from './dto/redeem-scenario.dto';
import { ListScenariosResponseDto } from './dto/list-scenarios-response.dto';
import { ScenarioDetailDto } from './dto/scenario-detail.dto';
import { ScenariosListingService } from './services/scenarios-listing.service';
import { ScenariosRedeemService } from './services/scenarios-redeem.service';
import { ScenariosDetailService } from './services/scenarios-detail.service';

const LANGUAGE_HEADER: Parameters<typeof ApiHeader>[0] = {
  name: 'X-Learning-Language',
  description: 'Active learning language code (e.g. en, es)',
  required: true,
};

@ApiTags('scenarios')
@ApiBearerAuth('JWT-auth')
@Controller('scenarios')
export class ScenariosController {
  constructor(
    private readonly listingService: ScenariosListingService,
    private readonly redeemService: ScenariosRedeemService,
    private readonly detailService: ScenariosDetailService,
  ) {}

  @Get('default')
  @AutoEnrollLanguage()
  @ApiHeader(LANGUAGE_HEADER)
  @ApiOperation({ summary: 'List default scenarios for active language' })
  @ApiResponse({ status: 200, type: ListScenariosResponseDto<ScenarioDefaultDto> })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  listDefault(
    @ActiveLanguage() lang: ActiveLanguageContext,
    @Query() query: ListScenariosQueryDto,
  ) {
    return this.listingService.listDefault(lang.id, query.page, query.limit);
  }

  @Get('personal')
  @AutoEnrollLanguage()
  @ApiHeader(LANGUAGE_HEADER)
  @ApiOperation({ summary: 'List personalized + KOL-granted scenarios' })
  @ApiResponse({ status: 200, type: ListScenariosResponseDto<ScenarioPersonalDto> })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  listPersonal(
    @CurrentUser() user: { id: string },
    @ActiveLanguage() lang: ActiveLanguageContext,
    @Query() query: ListScenariosQueryDto,
  ) {
    return this.listingService.listPersonal(user.id, lang.id, query.page, query.limit);
  }

  @Get(':id')
  @AutoEnrollLanguage()
  @ApiHeader(LANGUAGE_HEADER)
  @ApiOperation({ summary: 'Get scenario detail' })
  @ApiResponse({ status: 200, type: ScenarioDetailDto })
  @ApiResponse({ status: 400, description: 'Missing or invalid X-Learning-Language header' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Scenario not found or language mismatch' })
  getById(
    @CurrentUser() user: { id: string },
    @ActiveLanguage() lang: ActiveLanguageContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.detailService.get(user.id, id, lang.id);
  }

  @Post('redeem')
  @HttpCode(200)
  @SkipLanguageContext()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Redeem a KOL gift code' })
  @ApiResponse({ status: 200, type: RedeemResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Gift code not found' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  redeem(@CurrentUser() user: { id: string }, @Body() dto: RedeemScenarioDto) {
    return this.redeemService.redeem(user.id, dto.giftCode);
  }
}
