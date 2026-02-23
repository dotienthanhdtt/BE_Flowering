import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { LLMModel } from '../providers/llm-models.enum';

/**
 * Request DTO for exercise generation.
 */
export class GenerateExerciseRequestDto {
  @ApiProperty({
    description: 'Type of exercise to generate',
    example: 'multiple-choice',
    enum: ['multiple-choice', 'fill-in-blank', 'translation', 'matching', 'listening'],
  })
  @IsString()
  exerciseType!: string;

  @ApiProperty({ description: 'Target language', example: 'Japanese' })
  @IsString()
  targetLanguage!: string;

  @ApiProperty({
    description: 'User proficiency level',
    example: 'intermediate',
  })
  @IsString()
  proficiencyLevel!: string;

  @ApiProperty({ description: 'Exercise topic', example: 'Food vocabulary' })
  @IsString()
  topic!: string;

  @ApiPropertyOptional({
    description: 'Override default LLM model',
    enum: LLMModel,
  })
  @IsOptional()
  @IsEnum(LLMModel)
  model?: LLMModel;
}

/**
 * Result DTO for generated exercise.
 */
export class ExerciseResult {
  @ApiProperty({ description: 'Exercise type' })
  type!: string;

  @ApiProperty({ description: 'Exercise question or prompt' })
  question!: string;

  @ApiPropertyOptional({ description: 'Options for multiple choice', type: [String] })
  options?: string[];

  @ApiProperty({ description: 'Correct answer' })
  correctAnswer!: string;

  @ApiProperty({ description: 'Explanation of the answer' })
  explanation!: string;

  @ApiPropertyOptional({ description: 'Additional hints', type: [String] })
  hints?: string[];
}
