import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
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
import { ScenariosModule } from './modules/scenario/scenarios.module';
import { KolBundleModule } from './modules/kol-bundle/kol-bundle.module';
import { VocabularyModule } from './modules/vocabulary/vocabulary.module';
import { ProgressModule } from './modules/progress/progress.module';
import { AdminContentModule } from './modules/admin-content/admin-content.module';
import { PersonalizationModule } from './modules/personalization/personalization.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { LanguageContextGuard } from './common/guards/language-context.guard';
import { PremiumGuard } from './common/guards/premium.guard';
import { LanguageContextModule } from './common/language-context.module';
import { FrameworkLevelsModule } from './common/framework-levels.module';
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
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    DatabaseModule,
    FrameworkLevelsModule,
    LanguageContextModule,
    AuthModule,
    AiModule,
    UserModule,
    LanguageModule,
    SubscriptionModule,
    OnboardingModule,
    LessonModule,
    ScenarioChatModule,
    ScenariosModule,
    KolBundleModule,
    VocabularyModule,
    ProgressModule,
    AdminContentModule,
    PersonalizationModule,
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
    {
      provide: APP_GUARD,
      useClass: PremiumGuard,
    },
  ],
  exports: [SupabaseStorageService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpLoggerMiddleware).forRoutes('*');
    consumer
      .apply(SnakeToCamelCaseMiddleware)
      .exclude({ path: 'webhooks/revenuecat', method: RequestMethod.ALL })
      .forRoutes('*');
  }
}
