import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

const makeCtx = (
  user: unknown,
  handler: () => string[] | undefined,
  cls: () => string[] | undefined,
): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  let guard: RolesGuard;

  beforeEach(() => {
    const reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows when no metadata set', () => {
    const ctx = makeCtx({ roles: ['user'] }, () => undefined, () => undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows when user has required role', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['admin']) } as unknown as Reflector;
    guard = new RolesGuard(reflector);
    const ctx = makeCtx({ roles: ['admin', 'user'] }, () => undefined, () => undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws when user lacks required role', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['admin']) } as unknown as Reflector;
    guard = new RolesGuard(reflector);
    const ctx = makeCtx({ roles: ['user'] }, () => undefined, () => undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws when user is undefined', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['admin']) } as unknown as Reflector;
    guard = new RolesGuard(reflector);
    const ctx = makeCtx(undefined, () => undefined, () => undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
