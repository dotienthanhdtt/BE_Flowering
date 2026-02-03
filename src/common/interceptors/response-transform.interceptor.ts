import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { BaseResponseDto } from '../dto/base-response.dto';

@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<T, BaseResponseDto<T>> {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<BaseResponseDto<T>> {
    return next.handle().pipe(
      map((data: T) => {
        // If already a BaseResponseDto, return as-is
        if (data instanceof BaseResponseDto) {
          return data;
        }
        return BaseResponseDto.success(data);
      }),
    );
  }
}
