import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KolBundle } from '@/database/entities/kol-bundle.entity';
import { KolBundleScenario } from '@/database/entities/kol-bundle-scenario.entity';
import { Scenario } from '@/database/entities/scenario.entity';
import { User } from '@/database/entities/user.entity';
import { KolBundleController } from './kol-bundle.controller';
import { KolBundleService } from './kol-bundle.service';

@Module({
  imports: [TypeOrmModule.forFeature([KolBundle, KolBundleScenario, Scenario, User])],
  controllers: [KolBundleController],
  providers: [KolBundleService],
})
export class KolBundleModule {}
