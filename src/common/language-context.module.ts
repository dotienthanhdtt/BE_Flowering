import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Language } from '@/database/entities/language.entity';
import { UserLanguage } from '@/database/entities/user-language.entity';
import { LanguageContextCacheService } from './services/language-context-cache.service';
import { LanguageContextGuard } from './guards/language-context.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Language, UserLanguage])],
  providers: [LanguageContextCacheService, LanguageContextGuard],
  exports: [LanguageContextCacheService, LanguageContextGuard, TypeOrmModule],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class LanguageContextModule {}
