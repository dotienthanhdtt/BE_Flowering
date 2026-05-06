import { ApiProperty } from '@nestjs/swagger';

export class PersonalizeScenarioDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty()
  languageId!: string;
}
