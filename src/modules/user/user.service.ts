import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
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
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['nativeLanguage'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.mapToProfileDto(user);
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
   * Map User entity to UserProfileDto
   */
  private mapToProfileDto(user: User): UserProfileDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      nativeLanguageId: user.nativeLanguageId,
      nativeLanguageCode: user.nativeLanguage?.code,
      nativeLanguageName: user.nativeLanguage?.name,
      createdAt: user.createdAt,
    };
  }
}
