import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LanguageController } from './language.controller';
import { LanguageService } from './language.service';
import { Language } from '../../database/entities/language.entity';
import { UserLanguage } from '../../database/entities/user-language.entity';
import { User } from '../../database/entities/user.entity';
import { IsValidLevelForLanguageConstraint } from '../../common/validators/is-valid-level-for-language.validator';

@Module({
  imports: [TypeOrmModule.forFeature([Language, UserLanguage, User])],
  controllers: [LanguageController],
  providers: [LanguageService, IsValidLevelForLanguageConstraint],
  exports: [LanguageService],
})
export class LanguageModule {}
