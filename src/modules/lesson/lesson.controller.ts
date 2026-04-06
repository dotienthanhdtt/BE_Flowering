import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LessonService } from './lesson.service';
import { GetLessonsQueryDto } from './dto/get-lessons-query.dto';
import { GetLessonsResponseDto } from './dto/lesson-response.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';

@ApiTags('lessons')
@Controller('lessons')
export class LessonController {
  constructor(private readonly lessonService: LessonService) {}

  @Get()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get home screen lessons grouped by category' })
  async getLessons(
    @CurrentUser() user: User,
    @Query() query: GetLessonsQueryDto,
  ): Promise<GetLessonsResponseDto> {
    return this.lessonService.getLessons(user.id, query);
  }
}
