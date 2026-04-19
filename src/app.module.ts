import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
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
import { LessonModule } from './modules/lesson/lesson.module';
import { ScenarioChatModule } from './modules/scenario/scenario-chat.module';
import { VocabularyModule } from './modules/vocabulary/vocabulary.module';
import { ProgressModule } from './modules/progress/progress.module';
import { AdminContentModule } from './modules/admin-content/admin-content.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { LanguageContextGuard } from './common/guards/language-context.guard';
import { LanguageContextModule } from './common/language-context.module';
import { HttpLoggerMiddleware } from '@common/middleware/http-logger.middleware';
import { SnakeToCamelCaseMiddleware } from '@common/middleware/snake-to-camel-case.middleware';

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
    LanguageContextModule,
    AuthModule,
    AiModule,
    UserModule,
    LanguageModule,
    SubscriptionModule,
    OnboardingModule,
    LessonModule,
    ScenarioChatModule,
    VocabularyModule,
    ProgressModule,
    AdminContentModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    SupabaseStorageService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: LanguageContextGuard,
    },
  ],
  exports: [SupabaseStorageService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpLoggerMiddleware).forRoutes('*');
    consumer
      .apply(SnakeToCamelCaseMiddleware)
      .exclude({ path: 'subscription/webhook', method: RequestMethod.ALL })
      .forRoutes('*');
  }
}
