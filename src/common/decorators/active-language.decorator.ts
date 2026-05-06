import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
  SetMetadata,
} from '@nestjs/common';

export interface ActiveLanguageContext {
  id: string;
  code: string;
}

export const ActiveLanguage = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ActiveLanguageContext => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.activeLanguage) {
      throw new InternalServerErrorException('LanguageContextGuard not applied to this route');
    }
    return req.activeLanguage as ActiveLanguageContext;
  },
);

export const SKIP_LANGUAGE_CONTEXT = 'skipLanguageContext';
export const SkipLanguageContext = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(SKIP_LANGUAGE_CONTEXT, true);

export const AUTO_ENROLL_LANGUAGE = 'autoEnrollLanguage';
export const AutoEnrollLanguage = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(AUTO_ENROLL_LANGUAGE, true);
