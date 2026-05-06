import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PersonalizeCompleteDto {
  @ApiProperty({ description: 'Conversation ID to complete and generate scenarios from' })
  @IsUUID()
  conversationId!: string;
}
