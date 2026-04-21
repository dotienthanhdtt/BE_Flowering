import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { KolBundleResponseDto } from './dto/kol-bundle-response.dto';
import { Roles } from '@common/decorators/roles.decorator';
import { RolesGuard } from '@common/guards/roles.guard';
import { SkipLanguageContext } from '@common/decorators/active-language.decorator';
import { KolBundleService } from './kol-bundle.service';
import { CreateKolBundleDto } from './dto/create-kol-bundle.dto';
import { AttachScenariosDto } from './dto/attach-scenarios.dto';
import { ListKolBundlesQueryDto } from './dto/list-kol-bundles-query.dto';

@ApiTags('admin-kol-bundles')
@ApiBearerAuth('JWT-auth')
@Controller('admin/kol-bundles')
@UseGuards(RolesGuard)
@Roles('admin')
@SkipLanguageContext()
export class KolBundleController {
  constructor(private readonly kolBundleService: KolBundleService) {}

  @Post()
  @ApiOperation({ summary: 'Create a KOL bundle with scenarios' })
  @ApiResponse({ status: 201, type: KolBundleResponseDto })
  @ApiResponse({ status: 400, description: 'Creator not found or missing kol role' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Requires admin role' })
  @ApiResponse({ status: 409, description: 'Duplicate gift code or scenario already in bundle' })
  create(@Body() dto: CreateKolBundleDto) {
    return this.kolBundleService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List KOL bundles (paginated)' })
  @ApiResponse({ status: 200, type: KolBundleResponseDto, isArray: true })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Requires admin role' })
  list(@Query() query: ListKolBundlesQueryDto) {
    return this.kolBundleService.list(query);
  }

  @Post(':id/scenarios')
  @ApiOperation({ summary: 'Attach additional scenarios to an existing bundle' })
  @ApiResponse({ status: 201, type: KolBundleResponseDto })
  @ApiResponse({ status: 400, description: 'One or more scenarios not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Requires admin role' })
  @ApiResponse({ status: 404, description: 'Bundle not found' })
  @ApiResponse({ status: 409, description: 'Scenario already attached to a bundle' })
  attachScenarios(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AttachScenariosDto) {
    return this.kolBundleService.attachScenarios(id, dto);
  }
}
