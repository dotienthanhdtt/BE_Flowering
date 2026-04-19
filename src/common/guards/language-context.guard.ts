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
import { UserLanguage, ProficiencyLevel } from '@/database/entities/user-language.entity';
import { Language } from '@/database/entities/language.entity';
import { User } from '@/database/entities/user.entity';
import { IS_PUBLIC_KEY } from '@common/decorators/public-route.decorator';
import {
  SKIP_LANGUAGE_CONTEXT,
  AUTO_ENROLL_LANGUAGE,
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
    @InjectRepository(Language)
    private readonly languageRepo: Repository<Language>,
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
        await this.assertOrAutoEnroll(user.id, lang, context);
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

  private async assertOrAutoEnroll(
    userId: string,
    lang: ActiveLanguageContext,
    context: ExecutionContext,
  ): Promise<void> {
    const enrolled = await this.userLanguageRepo.findOne({
      where: { userId, languageId: lang.id },
    });
    if (enrolled) return;

    const autoEnroll = this.reflector.getAllAndOverride<boolean>(
      AUTO_ENROLL_LANGUAGE,
      [context.getHandler(), context.getClass()],
    );
    if (!autoEnroll) {
      throw new ForbiddenException(`Language "${lang.code}" not enrolled for this user`);
    }

    await this.autoEnroll(userId, lang);
  }

  private async autoEnroll(userId: string, lang: ActiveLanguageContext): Promise<void> {
    try {
      const language = await this.languageRepo.findOne({
        where: { id: lang.id, isActive: true, isLearningAvailable: true },
      });
      if (!language) {
        throw new BadRequestException(`Language "${lang.code}" is not available for learning`);
      }

      await this.userLanguageRepo.save(
        this.userLanguageRepo.create({
          userId,
          languageId: lang.id,
          isActive: false,
          proficiencyLevel: ProficiencyLevel.BEGINNER,
        }),
      );
      this.logger.log(`Auto-enrolled user ${userId} in language "${lang.code}"`);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      // Race condition (concurrent request already inserted) or transient failure
      const exists = await this.userLanguageRepo.findOne({
        where: { userId, languageId: lang.id },
      });
      if (!exists) {
        this.logger.warn(`Auto-enroll failed for user ${userId}, language "${lang.code}"`, error as Error);
      }
    }
  }
}
