import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserLanguage } from '@/database/entities/user-language.entity';
import { User } from '@/database/entities/user.entity';
import { IS_PUBLIC_KEY } from '@common/decorators/public-route.decorator';
import {
  SKIP_LANGUAGE_CONTEXT,
  ActiveLanguageContext,
} from '@common/decorators/active-language.decorator';
import { LanguageContextCacheService } from '@common/services/language-context-cache.service';

@Injectable()
export class LanguageContextGuard implements CanActivate {
  private readonly logger = new Logger(LanguageContextGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly languageCache: LanguageContextCacheService,
    @InjectRepository(UserLanguage)
    private readonly userLanguageRepo: Repository<UserLanguage>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(SKIP_LANGUAGE_CONTEXT, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as User | undefined;
    const headerCode = (request.headers['x-learning-language'] as string | undefined)?.trim().toLowerCase();

    if (headerCode) {
      const lang = await this.languageCache.resolve(headerCode);
      if (!lang) {
        throw new BadRequestException(`Unknown or inactive language code: "${headerCode}"`);
      }

      if (user) {
        await this.assertEnrolled(user.id, lang);
      }

      request.activeLanguage = lang;
      return true;
    }

    // No header — authenticated fallback
    if (user) {
      const activeUserLang = await this.userLanguageRepo.findOne({
        where: { userId: user.id, isActive: true },
        relations: ['language'],
      });

      if (!activeUserLang?.language) {
        throw new BadRequestException('Active learning language required. Send X-Learning-Language header.');
      }

      this.logger.warn(`X-Learning-Language header missing for user ${user.id}; falling back to UserLanguage.isActive`);

      const lang: ActiveLanguageContext = {
        id: activeUserLang.languageId,
        code: activeUserLang.language.code,
      };
      request.activeLanguage = lang;
      return true;
    }

    // Anonymous — no header, no user
    throw new BadRequestException('X-Learning-Language header required for anonymous requests');
  }

  private async assertEnrolled(userId: string, lang: ActiveLanguageContext): Promise<void> {
    const enrolled = await this.userLanguageRepo.findOne({
      where: { userId, languageId: lang.id },
    });
    if (!enrolled) {
      throw new ForbiddenException(`Language "${lang.code}" not enrolled for this user`);
    }
  }
}
