import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public-route.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../../../common/decorators/optional-auth.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) {
      return true;
    }

    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, targets);
    if (isOptionalAuth) {
      // Attempt JWT validation but don't reject on failure
      try {
        await (super.canActivate(context) as Promise<boolean>);
      } catch {
        // JWT missing/invalid — allow through, user will be null on request
      }
      return true;
    }

    return super.canActivate(context) as Promise<boolean>;
  }

  // Allow null user when optional auth is active
  handleRequest<TUser = any>(err: any, user: any, _info: any, context: ExecutionContext): TUser {
    const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isOptionalAuth && !user) {
      return null as TUser;
    }

    if (err || !user) {
      throw err || new UnauthorizedException();
    }
    return user;
  }
}
