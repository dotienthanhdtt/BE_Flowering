import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import appConfiguration from './config/app-configuration';
import { environmentValidationSchema } from './config/environment-validation-schema';
import { DatabaseModule } from './database/database.module';
import { SupabaseStorageService } from './database/supabase-storage.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { AiModule } from './modules/ai/ai.module';
import { UserModule } from './modules/user/user.module';
import { LanguageModule } from './modules/language/language.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { HttpLoggerMiddleware } from '@common/middleware/http-logger.middleware';

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
    AuthModule,
    AiModule,
    UserModule,
    LanguageModule,
    SubscriptionModule,
    OnboardingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    SupabaseStorageService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [SupabaseStorageService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpLoggerMiddleware).forRoutes('*');
  }
}
