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
import { Roles } from '@common/decorators/roles.decorator';
import { RolesGuard } from '@common/guards/roles.guard';
import { SkipLanguageContext } from '@common/decorators/active-language.decorator';
import { KolBundleService } from './kol-bundle.service';
import { CreateKolBundleDto } from './dto/create-kol-bundle.dto';
import { AttachScenariosDto } from './dto/attach-scenarios.dto';
import { ListKolBundlesQueryDto } from './dto/list-kol-bundles-query.dto';

@ApiTags('admin-kol-bundles')
@ApiBearerAuth()
@Controller('admin/kol-bundles')
@UseGuards(RolesGuard)
@Roles('admin')
@SkipLanguageContext()
export class KolBundleController {
  constructor(private readonly kolBundleService: KolBundleService) {}

  @Post()
  @ApiOperation({ summary: 'Create a KOL bundle with scenarios' })
  @ApiResponse({ status: 201 })
  create(@Body() dto: CreateKolBundleDto) {
    return this.kolBundleService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List KOL bundles' })
  @ApiResponse({ status: 200 })
  list(@Query() query: ListKolBundlesQueryDto) {
    return this.kolBundleService.list(query);
  }

  @Post(':id/scenarios')
  @ApiOperation({ summary: 'Attach scenarios to a bundle' })
  @ApiResponse({ status: 200 })
  attachScenarios(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachScenariosDto,
  ) {
    return this.kolBundleService.attachScenarios(id, dto);
  }
}
