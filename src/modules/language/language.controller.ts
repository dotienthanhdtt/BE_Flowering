import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { LanguageService } from './language.service';
import { LanguageDto } from './dto/language.dto';
import { UserLanguageDto } from './dto/user-language.dto';
import { AddUserLanguageDto } from './dto/add-user-language.dto';
import { UpdateUserLanguageDto } from './dto/update-user-language.dto';
import { SetNativeLanguageDto } from './dto/set-native-language.dto';
import { LanguageQueryDto, LanguageType } from './dto/language-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public-route.decorator';
import { SkipLanguageContext } from '../../common/decorators/active-language.decorator';
import { User } from '../../database/entities/user.entity';

/**
 * Controller for language endpoints (available languages, user learning languages)
 */
@ApiTags('languages')
@SkipLanguageContext()
@Controller('languages')
export class LanguageController {
  constructor(private readonly languageService: LanguageService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List available languages (optionally filter by type)' })
  @ApiQuery({ name: 'type', enum: LanguageType, required: false })
  async getLanguages(@Query() query: LanguageQueryDto): Promise<LanguageDto[]> {
    return this.languageService.findAll(query.type);
  }

  @ApiBearerAuth('JWT-auth')
  @Get('user')
  @ApiOperation({ summary: 'Get user learning languages' })
  async getUserLanguages(@CurrentUser() user: User): Promise<UserLanguageDto[]> {
    return this.languageService.getUserLanguages(user.id);
  }

  @ApiBearerAuth('JWT-auth')
  @Post('user')
  @ApiOperation({ summary: 'Add language to user learning list' })
  async addUserLanguage(
    @CurrentUser() user: User,
    @Body() dto: AddUserLanguageDto,
  ): Promise<UserLanguageDto> {
    return this.languageService.addUserLanguage(user.id, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Patch('user/native')
  @ApiOperation({ summary: 'Set user native language' })
  async setNativeLanguage(
    @CurrentUser() user: User,
    @Body() dto: SetNativeLanguageDto,
  ): Promise<LanguageDto> {
    return this.languageService.setNativeLanguage(user.id, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Patch('user/:languageId')
  @ApiOperation({ summary: 'Update user language proficiency' })
  async updateUserLanguage(
    @CurrentUser() user: User,
    @Param('languageId', ParseUUIDPipe) languageId: string,
    @Body() dto: UpdateUserLanguageDto,
  ): Promise<UserLanguageDto> {
    return this.languageService.updateUserLanguage(user.id, languageId, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Delete('user/:languageId')
  @ApiOperation({ summary: 'Remove language from user learning list' })
  async removeUserLanguage(
    @CurrentUser() user: User,
    @Param('languageId', ParseUUIDPipe) languageId: string,
  ): Promise<void> {
    return this.languageService.removeUserLanguage(user.id, languageId);
  }
}
