import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { UserLanguage } from '../../database/entities/user-language.entity';
import { AiConversation } from '../../database/entities/ai-conversation.entity';
import { Language } from '../../database/entities/language.entity';
import { UserProfileDto } from './dto/user-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { FrameworkLevelsService } from '../../common/services/framework-levels.service';
import { mapGenericToFramework } from '../../common/constants/language-levels';

/**
 * Service handling user profile operations (get, update)
 */
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserLanguage)
    private readonly userLanguageRepo: Repository<UserLanguage>,
    @InjectRepository(AiConversation)
    private readonly conversationRepo: Repository<AiConversation>,
    @InjectRepository(Language)
    private readonly languageRepo: Repository<Language>,
    private readonly frameworkLevels: FrameworkLevelsService,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  /**
   * Get user profile with native language + onboarding-extracted profile.
   * `profile` mirrors the shape of POST /onboarding/complete; null until extraction occurred.
   */
  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const activeLanguage = await this.getActiveLanguageCode(userId);
    const profile = await this.getOnboardingProfile(userId);
    return this.mapToProfileDto(user, activeLanguage, profile);
  }

  async update(userId: string, dto: UpdateUserDto): Promise<UserProfileDto> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await this.userRepo.update(userId, dto);
    return this.getProfile(userId);
  }

  private async getActiveLanguageCode(userId: string): Promise<string | undefined> {
    const userLanguage = await this.userLanguageRepo.findOne({
      where: { userId, lastLearned: true },
      relations: ['language'],
    });
    return userLanguage?.language?.code;
  }

  /**
   * Latest authenticated conversation with extracted profile, shaped like /onboarding/complete.
   * Returns null when user has no extracted profile yet.
   */
  private async getOnboardingProfile(userId: string): Promise<Record<string, unknown> | null> {
    const conversation = await this.conversationRepo.findOne({
      where: { userId, extractedProfile: Not(IsNull()) },
      order: { createdAt: 'DESC' },
    });
    if (!conversation || !conversation.extractedProfile) return null;

    const extracted = conversation.extractedProfile as Record<string, unknown>;
    const language = conversation.languageId
      ? await this.languageRepo.findOne({ where: { id: conversation.languageId } })
      : null;
    const suggestedFrameworkLevel = this.mapOnboardingLevel(
      this.frameworkLevels.getFrameworkCode(language?.id),
      extracted.suggestedProficiency as string | undefined,
    );

    return {
      ...extracted,
      suggestedFrameworkLevel,
      scenarios: conversation.scenarios ?? [],
    };
  }

  private mapOnboardingLevel(framework: string | null, suggestion: string | undefined): string {
    const generic = (suggestion ?? 'beginner').toLowerCase();
    if (!framework) return generic;
    try {
      return mapGenericToFramework(framework, generic);
    } catch {
      const lowest = this.frameworkLevels.getLevels(framework)[0]?.code ?? generic;
      this.logger.warn(
        `Invalid onboarding suggestion '${generic}' for framework ${framework}; defaulting to ${lowest}`,
      );
      return lowest;
    }
  }

  private mapToProfileDto(
    user: User,
    activeLanguage?: string,
    profile: Record<string, unknown> | null = null,
  ): UserProfileDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      nativeLanguage: user.nativeLanguage,
      activeLanguage,
      createdAt: user.createdAt,
      profile,
    };
  }
}
