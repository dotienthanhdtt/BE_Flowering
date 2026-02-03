import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LanguageController } from './language.controller';
import { LanguageService } from './language.service';
import { Language } from '../../database/entities/language.entity';
import { UserLanguage } from '../../database/entities/user-language.entity';

/**
 * Language module for available languages and user learning languages management
 */
@Module({
  imports: [TypeOrmModule.forFeature([Language, UserLanguage])],
  controllers: [LanguageController],
  providers: [LanguageService],
  exports: [LanguageService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class LanguageModule {}
