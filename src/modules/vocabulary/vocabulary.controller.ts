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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { VocabularyService } from './services/vocabulary.service';
import { VocabularyQueryDto } from './dto/vocabulary-query.dto';
import { VocabularyItemDto, VocabularyListDto } from './dto/vocabulary-response.dto';

@ApiTags('Vocabulary')
@ApiBearerAuth()
@Controller('vocabulary')
export class VocabularyController {
  constructor(private readonly service: VocabularyService) {}

  @Get()
  @ApiOperation({ summary: 'List my vocabulary with optional filters' })
  @ApiResponse({ status: 200, type: VocabularyListDto })
  list(@Req() req: any, @Query() q: VocabularyQueryDto): Promise<VocabularyListDto> {
    return this.service.list(req.user.id, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single vocabulary item' })
  @ApiResponse({ status: 200, type: VocabularyItemDto })
  findOne(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VocabularyItemDto> {
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
