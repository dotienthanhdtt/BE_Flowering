import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LanguageService } from './language.service';
import { LanguageDto } from './dto/language.dto';
import { UserLanguageDto } from './dto/user-language.dto';
import { AddUserLanguageDto } from './dto/add-user-language.dto';
import { UpdateUserLanguageDto } from './dto/update-user-language.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public-route.decorator';
import { User } from '../../database/entities/user.entity';

/**
 * Controller for language endpoints (available languages, user learning languages)
 */
@ApiTags('languages')
@Controller('languages')
export class LanguageController {
  constructor(private readonly languageService: LanguageService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List all available languages' })
  async getLanguages(): Promise<LanguageDto[]> {
    return this.languageService.findAll();
  }

  @ApiBearerAuth()
  @Get('user')
  @ApiOperation({ summary: 'Get user learning languages' })
  async getUserLanguages(@CurrentUser() user: User): Promise<UserLanguageDto[]> {
    return this.languageService.getUserLanguages(user.id);
  }

  @ApiBearerAuth()
  @Post('user')
  @ApiOperation({ summary: 'Add language to user learning list' })
  async addUserLanguage(
    @CurrentUser() user: User,
    @Body() dto: AddUserLanguageDto,
  ): Promise<UserLanguageDto> {
    return this.languageService.addUserLanguage(user.id, dto);
  }

  @ApiBearerAuth()
  @Patch('user/:languageId')
  @ApiOperation({ summary: 'Update user language proficiency' })
  async updateUserLanguage(
    @CurrentUser() user: User,
    @Param('languageId', ParseUUIDPipe) languageId: string,
    @Body() dto: UpdateUserLanguageDto,
  ): Promise<UserLanguageDto> {
    return this.languageService.updateUserLanguage(user.id, languageId, dto);
  }

  @ApiBearerAuth()
  @Delete('user/:languageId')
  @ApiOperation({ summary: 'Remove language from user learning list' })
  async removeUserLanguage(
    @CurrentUser() user: User,
    @Param('languageId', ParseUUIDPipe) languageId: string,
  ): Promise<void> {
    return this.languageService.removeUserLanguage(user.id, languageId);
  }
}
