import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfiguration from './config/app-configuration';
import { environmentValidationSchema } from './config/environment-validation-schema';
import { DatabaseModule } from './database/database.module';
import { SupabaseStorageService } from './database/supabase-storage.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfiguration],
      validationSchema: environmentValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    DatabaseModule,
  ],
  controllers: [AppController],
  providers: [AppService, SupabaseStorageService],
  exports: [SupabaseStorageService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
