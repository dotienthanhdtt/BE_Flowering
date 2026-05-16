import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PersonalizeChatDto {
  @ApiProperty({ required: false, description: 'Existing conversation ID to resume' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiProperty({ required: false, description: 'User message. Omit on first turn.' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiProperty({ required: false, description: 'Scenario that triggered this personalization offer' })
  @IsOptional()
  @IsUUID()
  sourceScenarioId?: string;
}
