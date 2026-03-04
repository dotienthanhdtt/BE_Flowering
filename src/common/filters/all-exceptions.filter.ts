import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { BaseResponseDto } from '../dto/base-response.dto';

interface ErrorResponse {
  message?: string | string[];
  error?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const errorResponse = exceptionResponse as ErrorResponse;
        if (Array.isArray(errorResponse.message)) {
          message = errorResponse.message.join(', ');
        } else if (errorResponse.message) {
          message = errorResponse.message;
        } else if (errorResponse.error) {
          message = errorResponse.error;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Log error for debugging
    console.error(`[${request.method}] ${request.url} - ${status}: ${message}`, exception);

    // Report 5xx errors to Sentry
    if (status >= 500) {
      Sentry.captureException(exception, {
        extra: { method: request.method, url: request.url, status },
      });
    }

    const errorResponse = BaseResponseDto.error(message);
    response.status(status).json(errorResponse);
  }
}
