import './instrument';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { setupSwaggerDocumentation } from './swagger/swagger-documentation-setup';
import { ResponseTransformInterceptor, AllExceptionsFilter } from './common';
import { toCamelCase } from './common/utils/case-converter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3000);
  const nodeEnv = configService.get<string>('nodeEnv', 'development');

  // Convert incoming snake_case request body keys to camelCase so existing DTO validation works.
  // Exclude RevenueCat webhook — it sends raw snake_case that its DTO handles internally.
  app.use((req: { path: string; body: unknown }, _res: unknown, next: () => void) => {
    if (!req.path.startsWith('/subscription/webhook') && req.body && typeof req.body === 'object') {
      req.body = toCamelCase(req.body);
    }
    next();
  });

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
