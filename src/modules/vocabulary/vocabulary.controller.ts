import {
  ActiveLanguage,
  ActiveLanguageContext,
} from '../../common/decorators/active-language.decorator';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { VocabularyService } from './services/vocabulary.service';
import { VocabularyQueryDto } from './dto/vocabulary-query.dto';
import { VocabularyItemDto, VocabularyListDto } from './dto/vocabulary-response.dto';

@ApiTags('Vocabulary')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Learning-Language',
  description: 'Active learning language code (e.g. en, es)',
  required: false,
})
@Controller('vocabulary')
export class VocabularyController {
  constructor(private readonly service: VocabularyService) {}

  @Get()
  @ApiOperation({ summary: 'List my vocabulary with optional filters' })
  @ApiResponse({ status: 200, type: VocabularyListDto })
  list(
    @Req() req: any,
    @ActiveLanguage() activeLanguage: ActiveLanguageContext,
    @Query() q: VocabularyQueryDto,
  ): Promise<VocabularyListDto> {
    return this.service.list(req.user.id, q, activeLanguage.code);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single vocabulary item' })
  @ApiResponse({ status: 200, type: VocabularyItemDto })
  findOne(@Req() req: any, @Param('id', ParseUUIDPipe) id: string): Promise<VocabularyItemDto> {
    return this.service.findOne(req.user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a vocabulary item' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  async remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.service.remove(req.user.id, id);
  }
}
