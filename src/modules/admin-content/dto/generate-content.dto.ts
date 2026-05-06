import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ContentType {
  LESSON = 'lesson',
  EXERCISE = 'exercise',
  SCENARIO = 'scenario',
}

export enum ContentLevel {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced',
}

export class GenerateContentDto {
  @ApiProperty({ example: 'es' })
  @IsString()
  languageCode!: string;

  @ApiProperty({ enum: ContentType })
  @IsEnum(ContentType)
  contentType!: ContentType;

  @ApiProperty({ enum: ContentLevel })
  @IsEnum(ContentLevel)
  level!: ContentLevel;

  @ApiProperty({ example: 3, minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  count!: number;

  @ApiPropertyOptional({ example: 'greetings and introductions', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topicHint?: string;
}
