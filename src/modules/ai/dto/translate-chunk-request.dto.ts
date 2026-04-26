import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, IsUUID, MaxLength, Min, registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

function IsTapRangeValid(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isTapRangeValid',
      target: (object as { constructor: Function }).constructor,
      propertyName,
      options: { message: 'tapTo must be greater than tapFrom', ...validationOptions },
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const obj = args.object as TranslateChunkRequestDto;
          return typeof obj.tapFrom === 'number' && typeof obj.tapTo === 'number' && obj.tapTo > obj.tapFrom;
        },
      },
    });
  };
}

export class TranslateChunkRequestDto {
  @ApiProperty({ description: 'Source AI chat message id' })
  @IsUUID()
  messageId!: string;

  @ApiProperty({ example: 'en' })
  @IsString()
  @MaxLength(10)
  sourceLang!: string;

  @ApiProperty({ example: 'vi' })
  @IsString()
  @MaxLength(10)
  targetLang!: string;

  @ApiProperty({ example: 4, description: 'Inclusive char index of tap start' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  tapFrom!: number;

  @ApiProperty({ example: 5, description: 'Exclusive char index of tap end' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsTapRangeValid()
  tapTo!: number;
}
