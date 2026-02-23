import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { LLMModel } from '../providers/llm-models.enum';

/**
 * Request DTO for grammar check endpoint.
 */
export class GrammarCheckRequestDto {
  @ApiProperty({ description: 'Text to check for grammar errors', maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  text!: string;

  @ApiProperty({ description: 'Target language of the text', example: 'Japanese' })
  @IsString()
  @MaxLength(50)
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
 * Individual grammar error detail.
 */
export class GrammarError {
  @ApiProperty({ description: 'Original incorrect phrase' })
  original!: string;

  @ApiProperty({ description: 'Corrected phrase' })
  correction!: string;

  @ApiProperty({ description: 'Explanation of the error' })
  explanation!: string;
}

/**
 * Result DTO for grammar check.
 */
export class GrammarCheckResult {
  @ApiProperty({ description: 'Whether the text is grammatically correct' })
  isCorrect!: boolean;

  @ApiProperty({ type: [GrammarError], description: 'List of grammar errors found' })
  errors!: GrammarError[];

  @ApiProperty({ description: 'Full corrected text' })
  correctedText!: string;
}
