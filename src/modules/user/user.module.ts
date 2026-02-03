import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User } from '../../database/entities/user.entity';

/**
 * User module for profile management (get, update)
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class UserModule {}
