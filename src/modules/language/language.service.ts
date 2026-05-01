import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Language } from '../../database/entities/language.entity';
import { UserLanguage } from '../../database/entities/user-language.entity';
import { User } from '../../database/entities/user.entity';
import { LanguageDto } from './dto/language.dto';
import { UserLanguageDto } from './dto/user-language.dto';
import { AddUserLanguageDto } from './dto/add-user-language.dto';
import { UpdateUserLanguageDto } from './dto/update-user-language.dto';
import { SetNativeLanguageDto } from './dto/set-native-language.dto';
import { LanguageType } from './dto/language-query.dto';
import { FrameworkLevelsService } from '../../common/services/framework-levels.service';

@Injectable()
export class LanguageService implements OnModuleInit {
  private readonly logger = new Logger(LanguageService.name);

  constructor(
    @InjectRepository(Language)
    private readonly languageRepo: Repository<Language>,
    @InjectRepository(UserLanguage)
    private readonly userLanguageRepo: Repository<UserLanguage>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly frameworkLevels: FrameworkLevelsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const learning = await this.languageRepo.find({ where: { isLearningAvailable: true } });
    const missing = learning.filter((l) => this.frameworkLevels.getLevels(l.id).length === 0);
    if (missing.length) {
      const msg = `Languages missing framework_levels rows: ${missing.map((b) => b.code).join(', ')}`;
      if (process.env.NODE_ENV !== 'production') throw new Error(msg);
      else this.logger.warn(msg);
    }
  }

  async findAll(type?: LanguageType): Promise<LanguageDto[]> {
    const where: Record<string, unknown> = { isActive: true };
    if (type === LanguageType.NATIVE) where.isNativeAvailable = true;
    else if (type === LanguageType.LEARNING) where.isLearningAvailable = true;

    const languages = await this.languageRepo.find({ where, order: { name: 'ASC' } });
    return languages.map((l) => this.mapToLanguageDto(l));
  }

  async setNativeLanguage(userId: string, dto: SetNativeLanguageDto): Promise<LanguageDto> {
    const language = await this.languageRepo.findOne({
      where: { code: dto.languageCode, isActive: true },
    });
    if (!language) throw new NotFoundException('Language not found');
    if (!language.isNativeAvailable) {
      throw new BadRequestException('Language is not available as a native language');
    }
    await this.userRepo.update(userId, { nativeLanguage: language.code });
    return this.mapToLanguageDto(language);
  }

  async getUserLanguages(userId: string): Promise<UserLanguageDto[]> {
    const userLanguages = await this.userLanguageRepo.find({
      where: { userId },
      relations: ['language'],
      order: { createdAt: 'DESC' },
    });
    return userLanguages.map((ul) => this.mapToUserLanguageDto(ul));
  }

  async addUserLanguage(userId: string, dto: AddUserLanguageDto): Promise<UserLanguageDto> {
    const language = await this.languageRepo.findOne({
      where: { id: dto.languageId, isActive: true },
    });
    if (!language) throw new NotFoundException('Language not found');
    if (!language.isLearningAvailable) {
      throw new BadRequestException('Language is not available for learning');
    }

    const existing = await this.userLanguageRepo.findOne({
      where: { userId, languageId: dto.languageId },
    });
    if (existing) throw new ConflictException('Language already added to learning list');

    await this.userLanguageRepo.update({ userId, lastLearned: true }, { lastLearned: false });

    // proficiencyLevel left undefined → DB trigger fills default; invalid → DB raises P0001
    const userLanguage = this.userLanguageRepo.create({
      userId,
      languageId: dto.languageId,
      proficiencyLevel: dto.proficiencyLevel,
      lastLearned: true,
    });
    const saved = await this.userLanguageRepo.save(userLanguage);

    const result = await this.userLanguageRepo.findOne({
      where: { id: saved.id },
      relations: ['language'],
    });
    return this.mapToUserLanguageDto(result!);
  }

  async updateUserLanguage(
    userId: string,
    languageId: string,
    dto: UpdateUserLanguageDto,
  ): Promise<UserLanguageDto> {
    const userLanguage = await this.userLanguageRepo.findOne({
      where: { userId, languageId },
      relations: ['language'],
    });
    if (!userLanguage) throw new NotFoundException('User language not found');

    if (dto.proficiencyLevel !== undefined) {
      // DB trigger validates
      userLanguage.proficiencyLevel = dto.proficiencyLevel;
    }

    if (dto.lastLearned !== undefined) {
      if (dto.lastLearned) {
        await this.userLanguageRepo.update({ userId, lastLearned: true }, { lastLearned: false });
      }
      userLanguage.lastLearned = dto.lastLearned;
    }

    const saved = await this.userLanguageRepo.save(userLanguage);
    return this.mapToUserLanguageDto(saved);
  }

  async getNativeLanguage(userId: string): Promise<Language | null> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user?.nativeLanguage) return null;
    return this.languageRepo.findOne({ where: { code: user.nativeLanguage } });
  }

  async removeUserLanguage(userId: string, languageId: string): Promise<void> {
    const result = await this.userLanguageRepo.delete({ userId, languageId });
    if (result.affected === 0) throw new NotFoundException('User language not found');
  }

  private mapToLanguageDto(lang: Language): LanguageDto {
    return {
      id: lang.id,
      code: lang.code,
      name: lang.name,
      nativeName: lang.nativeName,
      flagUrl: lang.flagUrl,
      isNativeAvailable: lang.isNativeAvailable,
      isLearningAvailable: lang.isLearningAvailable,
      levels: this.frameworkLevels.getLevels(lang.id),
    };
  }

  private mapToUserLanguageDto(ul: UserLanguage): UserLanguageDto {
    const level = ul.proficiencyLevel ?? '';
    return {
      id: ul.id,
      languageId: ul.languageId,
      proficiencyLevel: level,
      description: this.frameworkLevels.getDescription(ul.languageId, level),
      lastLearned: ul.lastLearned,
      createdAt: ul.createdAt,
      language: this.mapToLanguageDto(ul.language!),
    };
  }
}
