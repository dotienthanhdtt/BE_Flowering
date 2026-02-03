import { ApiProperty } from '@nestjs/swagger';

export class BaseResponseDto<T> {
  @ApiProperty({ example: 1, description: '1 for success, 0 for error' })
  code: number;

  @ApiProperty({ example: 'Success', description: 'Response message' })
  message: string;

  @ApiProperty({ description: 'Response payload' })
  data: T | null;

  constructor(code: number, message: string, data: T | null) {
    this.code = code;
    this.message = message;
    this.data = data;
  }

  static success<T>(data: T, message = 'Success'): BaseResponseDto<T> {
    return new BaseResponseDto(1, message, data);
  }

  static error<T>(message: string, data: T | null = null): BaseResponseDto<T> {
    return new BaseResponseDto(0, message, data);
  }
}
