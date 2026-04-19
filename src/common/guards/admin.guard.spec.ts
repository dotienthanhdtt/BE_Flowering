import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

const makeCtx = (user?: object): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('AdminGuard', () => {
  let guard: AdminGuard;

  beforeEach(() => {
    guard = new AdminGuard();
  });

  it('should allow access when user.isAdmin is true', () => {
    expect(guard.canActivate(makeCtx({ id: 'u1', isAdmin: true }))).toBe(true);
  });

  it('should throw ForbiddenException when user.isAdmin is false', () => {
    expect(() => guard.canActivate(makeCtx({ id: 'u1', isAdmin: false }))).toThrow(
      ForbiddenException,
    );
  });

  it('should throw ForbiddenException when user is undefined', () => {
    expect(() => guard.canActivate(makeCtx(undefined))).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when request has no user', () => {
    expect(() => guard.canActivate(makeCtx())).toThrow(ForbiddenException);
  });
});
