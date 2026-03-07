import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Language } from '../../database/entities/language.entity';
import { UserLanguage, ProficiencyLevel } from '../../database/entities/user-language.entity';
import { User } from '../../database/entities/user.entity';
import { LanguageDto } from './dto/language.dto';
import { UserLanguageDto } from './dto/user-language.dto';
import { AddUserLanguageDto } from './dto/add-user-language.dto';
import { UpdateUserLanguageDto } from './dto/update-user-language.dto';
import { SetNativeLanguageDto } from './dto/set-native-language.dto';
import { LanguageType } from './dto/language-query.dto';

/**
 * Service handling language operations and user learning languages
 */
@Injectable()
export class LanguageService {
  constructor(
    @InjectRepository(Language)
    private readonly languageRepo: Repository<Language>,
    @InjectRepository(UserLanguage)
    private readonly userLanguageRepo: Repository<UserLanguage>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Get active languages, optionally filtered by native/learning availability
   */
  async findAll(type?: LanguageType): Promise<LanguageDto[]> {
    const where: Record<string, unknown> = { isActive: true };

    if (type === LanguageType.NATIVE) {
      where.isNativeAvailable = true;
    } else if (type === LanguageType.LEARNING) {
      where.isLearningAvailable = true;
    }

    const languages = await this.languageRepo.find({
      where,
      order: { name: 'ASC' },
    });

    return languages.map((lang) => ({
      id: lang.id,
      code: lang.code,
      name: lang.name,
      nativeName: lang.nativeName,
      flagUrl: lang.flagUrl,
      isNativeAvailable: lang.isNativeAvailable,
      isLearningAvailable: lang.isLearningAvailable,
    }));
  }

  /**
   * Set user's native language
   */
  async setNativeLanguage(userId: string, dto: SetNativeLanguageDto): Promise<LanguageDto> {
    const language = await this.languageRepo.findOne({
      where: { id: dto.languageId, isActive: true },
    });

    if (!language) {
      throw new NotFoundException('Language not found');
    }

    if (!language.isNativeAvailable) {
      throw new BadRequestException('Language is not available as a native language');
    }

    await this.userRepo.update(userId, { nativeLanguageId: dto.languageId });

    return {
      id: language.id,
      code: language.code,
      name: language.name,
      nativeName: language.nativeName,
      flagUrl: language.flagUrl,
      isNativeAvailable: language.isNativeAvailable,
      isLearningAvailable: language.isLearningAvailable,
    };
  }

  /**
   * Get user's learning languages with language details
   */
  async getUserLanguages(userId: string): Promise<UserLanguageDto[]> {
    const userLanguages = await this.userLanguageRepo.find({
      where: { userId },
      relations: ['language'],
      order: { createdAt: 'DESC' },
    });

    return userLanguages.map((ul) => this.mapToUserLanguageDto(ul));
  }

  /**
   * Add language to user's learning list
   */
  async addUserLanguage(userId: string, dto: AddUserLanguageDto): Promise<UserLanguageDto> {
    // Check if language exists
    const language = await this.languageRepo.findOne({
      where: { id: dto.languageId, isActive: true },
    });

    if (!language) {
      throw new NotFoundException('Language not found');
    }

    if (!language.isLearningAvailable) {
      throw new BadRequestException('Language is not available for learning');
    }

    // Check if user already has this language
    const existing = await this.userLanguageRepo.findOne({
      where: { userId, languageId: dto.languageId },
    });

    if (existing) {
      throw new ConflictException('Language already added to learning list');
    }

    const userLanguage = this.userLanguageRepo.create({
      userId,
      languageId: dto.languageId,
      proficiencyLevel: dto.proficiencyLevel || ProficiencyLevel.BEGINNER,
    });

    const saved = await this.userLanguageRepo.save(userLanguage);

    // Reload with language relation
    const result = await this.userLanguageRepo.findOne({
      where: { id: saved.id },
      relations: ['language'],
    });

    return this.mapToUserLanguageDto(result!);
  }

  /**
   * Update user's language proficiency or active status
   */
  async updateUserLanguage(
    userId: string,
    languageId: string,
    dto: UpdateUserLanguageDto,
  ): Promise<UserLanguageDto> {
    const userLanguage = await this.userLanguageRepo.findOne({
      where: { userId, languageId },
      relations: ['language'],
    });

    if (!userLanguage) {
      throw new NotFoundException('User language not found');
    }

    if (dto.proficiencyLevel !== undefined) {
      userLanguage.proficiencyLevel = dto.proficiencyLevel;
    }

    if (dto.isActive !== undefined) {
      userLanguage.isActive = dto.isActive;
    }

    const saved = await this.userLanguageRepo.save(userLanguage);
    return this.mapToUserLanguageDto(saved);
  }

  /**
   * Remove language from user's learning list
   */
  async removeUserLanguage(userId: string, languageId: string): Promise<void> {
    const result = await this.userLanguageRepo.delete({ userId, languageId });

    if (result.affected === 0) {
      throw new NotFoundException('User language not found');
    }
  }

  /**
   * Map UserLanguage entity to DTO
   */
  private mapToUserLanguageDto(ul: UserLanguage): UserLanguageDto {
    return {
      id: ul.id,
      languageId: ul.languageId,
      proficiencyLevel: ul.proficiencyLevel,
      isActive: ul.isActive,
      createdAt: ul.createdAt,
      language: {
        id: ul.language.id,
        code: ul.language.code,
        name: ul.language.name,
        nativeName: ul.language.nativeName,
        flagUrl: ul.language.flagUrl,
        isNativeAvailable: ul.language.isNativeAvailable,
        isLearningAvailable: ul.language.isLearningAvailable,
      },
    };
  }
}
