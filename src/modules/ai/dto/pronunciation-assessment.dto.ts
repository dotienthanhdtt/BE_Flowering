import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { LLMModel } from '../providers/llm-models.enum';

/**
 * Request DTO for pronunciation assessment.
 * Audio file is uploaded separately via multipart form.
 */
export class PronunciationAssessmentRequestDto {
  @ApiProperty({ description: 'Expected text the user should have said' })
  @IsString()
  expectedText!: string;

  @ApiProperty({ description: 'Target language', example: 'Japanese' })
  @IsString()
  targetLanguage!: string;

  @ApiPropertyOptional({
    description: 'Override default LLM model',
    enum: LLMModel,
  })
  @IsOptional()
  @IsEnum(LLMModel)
  model?: LLMModel;
}

/**
 * Individual pronunciation error detail.
 */
export class PronunciationError {
  @ApiProperty({ description: 'Word or phrase with pronunciation issue' })
  word!: string;

  @ApiProperty({ description: 'What was detected vs expected' })
  issue!: string;

  @ApiProperty({ description: 'Suggestion for improvement' })
  suggestion!: string;
}

/**
 * Result DTO for pronunciation assessment.
 */
export class PronunciationResult {
  @ApiProperty({ description: 'Pronunciation score (0-100)' })
  score!: number;

  @ApiProperty({ description: 'Overall feedback on pronunciation' })
  feedback!: string;

  @ApiProperty({ type: [PronunciationError], description: 'Specific pronunciation errors' })
  errors!: PronunciationError[];

  @ApiPropertyOptional({ description: 'Transcribed text from audio' })
  transcribedText?: string;
}
