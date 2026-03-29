import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { toCamelCase } from '../utils/case-converter';

/**
 * Converts incoming snake_case request body keys to camelCase
 * so existing DTO validation works with snake_case API contract.
 */
@Injectable()
export class SnakeToCamelCaseMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (req.body && typeof req.body === 'object') {
      req.body = toCamelCase(req.body);
    }
    next();
  }
}
