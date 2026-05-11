import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FrameworkLevel } from '@/database/entities/framework-level.entity';
import { FrameworkLevelsService } from './services/framework-levels.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([FrameworkLevel])],
  providers: [FrameworkLevelsService],
  exports: [FrameworkLevelsService],
})
export class FrameworkLevelsModule {}
