import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { VocabularyReviewService } from './services/vocabulary-review.service';
import { ReviewStartDto, ReviewStartResponseDto } from './dto/review-start.dto';
import { ReviewRateDto, ReviewRateResponseDto } from './dto/review-rate.dto';
import { ReviewCompleteResponseDto } from './dto/review-complete.dto';

@ApiTags('Vocabulary Review')
@ApiBearerAuth()
@Controller('vocabulary/review')
export class VocabularyReviewController {
  constructor(private readonly service: VocabularyReviewService) {}

  @Post('start')
  @ApiOperation({ summary: 'Start a Leitner review session with due cards' })
  @ApiResponse({ status: 201, type: ReviewStartResponseDto })
  start(@Req() req: any, @Body() dto: ReviewStartDto): Promise<ReviewStartResponseDto> {
    return this.service.start(req.user.id, dto);
  }

  @Post(':sessionId/rate')
  @ApiOperation({ summary: 'Rate a card; applies Leitner transition and persists vocabulary' })
  @ApiResponse({ status: 201, type: ReviewRateResponseDto })
  rate(
    @Req() req: any,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: ReviewRateDto,
  ): Promise<ReviewRateResponseDto> {
    return this.service.rate(req.user.id, sessionId, dto);
  }

  @Post(':sessionId/complete')
  @ApiOperation({ summary: 'Complete review session; returns stats and deletes session' })
  @ApiResponse({ status: 201, type: ReviewCompleteResponseDto })
  complete(
    @Req() req: any,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<ReviewCompleteResponseDto> {
    return this.service.complete(req.user.id, sessionId);
  }
}
