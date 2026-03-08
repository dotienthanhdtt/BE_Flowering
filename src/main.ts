import './instrument';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { setupSwaggerDocumentation } from './swagger/swagger-documentation-setup';
import { ResponseTransformInterceptor, AllExceptionsFilter } from './common';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3000);
  const nodeEnv = configService.get<string>('nodeEnv', 'development');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global response interceptor
  app.useGlobalInterceptors(new ResponseTransformInterceptor());

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Enable CORS with configurable origins
  const corsOrigins = configService.get<string>('corsOrigins', '');
  app.enableCors({
    origin: corsOrigins ? corsOrigins.split(',').map((o) => o.trim()) : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Setup Swagger in non-production
  if (nodeEnv !== 'production') {
    setupSwaggerDocumentation(app);
    console.log(`Swagger docs available at http://localhost:${port}/api/docs`);
  }

  // Bind to 0.0.0.0 explicitly for Railway/Docker compatibility (IPv4)
  await app.listen(port, '0.0.0.0');
  console.log(`Application running on http://0.0.0.0:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
