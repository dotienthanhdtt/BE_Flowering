import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import { AdminGuard } from '@common/guards/admin.guard';
import { SkipLanguageContext } from '@common/decorators/active-language.decorator';
import { AdminContentService } from './admin-content.service';
import { GenerateContentDto, ContentType } from './dto/generate-content.dto';
import { ListContentQueryDto } from './dto/list-content-query.dto';
import { UpdateContentDto } from './dto/update-content.dto';

@ApiTags('admin-content')
@ApiHeader({ name: 'Authorization', required: true })
@Controller('admin/content')
@UseGuards(AdminGuard)
@SkipLanguageContext()
export class AdminContentController {
  constructor(private readonly adminContentService: AdminContentService) {}

  @Post('generate')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  generate(@Body() dto: GenerateContentDto, @CurrentUser() admin: { id: string }) {
    return this.adminContentService.generateDrafts(admin.id, dto);
  }

  @Get()
  list(@Query() query: ListContentQueryDto) {
    return this.adminContentService.listContent(query);
  }

  @Patch(':id/publish')
  publish(
    @Param('id') id: string,
    @Query('type', new ParseEnumPipe(ContentType)) type: ContentType,
  ) {
    return this.adminContentService.publishContent(id, type);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Query('type', new ParseEnumPipe(ContentType)) type: ContentType,
    @Body() dto: UpdateContentDto,
  ) {
    return this.adminContentService.updateContent(id, type, dto);
  }

  @Delete(':id')
  archive(
    @Param('id') id: string,
    @Query('type', new ParseEnumPipe(ContentType)) type: ContentType,
  ) {
    return this.adminContentService.archiveContent(id, type);
  }
}
