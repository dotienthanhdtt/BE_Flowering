import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { UserLanguage } from '../../database/entities/user-language.entity';
import { UserProfileDto } from './dto/user-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/**
 * Service handling user profile operations (get, update)
 */
@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserLanguage)
    private readonly userLanguageRepo: Repository<UserLanguage>,
  ) {}

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  /**
   * Get user profile with native language relation
   */
  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const activeLanguage = await this.getActiveLanguageCode(userId);
    return this.mapToProfileDto(user, activeLanguage);
  }

  /**
   * Update user profile fields
   */
  async update(userId: string, dto: UpdateUserDto): Promise<UserProfileDto> {
    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepo.update(userId, dto);
    return this.getProfile(userId);
  }

  /**
   * Resolve the active learning language code (last_learned = true)
   */
  private async getActiveLanguageCode(userId: string): Promise<string | undefined> {
    const userLanguage = await this.userLanguageRepo.findOne({
      where: { userId, lastLearned: true },
      relations: ['language'],
    });
    return userLanguage?.language?.code;
  }

  /**
   * Map User entity to UserProfileDto
   */
  private mapToProfileDto(user: User, activeLanguage?: string): UserProfileDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      nativeLanguage: user.nativeLanguage,
      activeLanguage,
      createdAt: user.createdAt,
    };
  }
}
