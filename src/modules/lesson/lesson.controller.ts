import { Controller, Get, Query } from '@nestjs/common';
import { ApiHeader, ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LessonService } from './lesson.service';
import { GetLessonsQueryDto } from './dto/get-lessons-query.dto';
import { GetLessonsResponseDto } from './dto/lesson-response.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ActiveLanguage, ActiveLanguageContext } from '../../common/decorators/active-language.decorator';
import { User } from '../../database/entities/user.entity';

@ApiTags('lessons')
@ApiBearerAuth('JWT-auth')
@ApiHeader({ name: 'X-Learning-Language', description: 'Active learning language code (e.g. en, es)', required: true })
@Controller('lessons')
export class LessonController {
  constructor(private readonly lessonService: LessonService) {}

  @Get()
  @ApiOperation({ summary: 'Get home screen lessons grouped by category' })
  async getLessons(
    @CurrentUser() user: User,
    @ActiveLanguage() lang: ActiveLanguageContext,
    @Query() query: GetLessonsQueryDto,
  ): Promise<GetLessonsResponseDto> {
    return this.lessonService.getLessons(user.id, lang.id, query);
  }
}
