import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User } from '../../database/entities/user.entity';
import { UserLanguage } from '../../database/entities/user-language.entity';
import { AiConversation } from '../../database/entities/ai-conversation.entity';
import { Language } from '../../database/entities/language.entity';

/**
 * User module for profile management (get, update)
 */
@Module({
  imports: [TypeOrmModule.forFeature([User, UserLanguage, AiConversation, Language])],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class UserModule {}
