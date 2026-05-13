import {
  ActiveLanguage,
  ActiveLanguageContext,
} from '../../common/decorators/active-language.decorator';
import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { VocabularyService } from './services/vocabulary.service';
import { VocabularyQueryDto } from './dto/vocabulary-query.dto';
import { VocabularyListDto } from './dto/vocabulary-response.dto';

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
    @Req() req: { user: { id: string } },
    @ActiveLanguage() activeLanguage: ActiveLanguageContext,
    @Query() q: VocabularyQueryDto,
  ): Promise<VocabularyListDto> {
    return this.service.list(req.user.id, q, activeLanguage.code);
  }

}
