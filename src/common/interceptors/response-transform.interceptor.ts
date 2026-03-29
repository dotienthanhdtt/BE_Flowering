import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { BaseResponseDto } from '../dto/base-response.dto';
import { toSnakeCase } from '../utils/case-converter';

@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<T, BaseResponseDto<T>> {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<BaseResponseDto<T>> {
    return next.handle().pipe(
      map((data: T) => {
        // If already a BaseResponseDto, convert its data payload to snake_case
        if (data instanceof BaseResponseDto) {
          data.data = toSnakeCase(data.data) as T;
          return data;
        }
        return BaseResponseDto.success(toSnakeCase(data) as T);
      }),
    );
  }
}
