import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { UserProfileDto } from './dto/user-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';

/**
 * Controller for user profile endpoints (GET/PATCH /users/me)
 */
@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@CurrentUser() user: User): Promise<UserProfileDto> {
    return this.userService.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateUserDto,
  ): Promise<UserProfileDto> {
    return this.userService.update(user.id, dto);
  }
}
