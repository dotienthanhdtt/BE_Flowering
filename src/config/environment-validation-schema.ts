import * as Joi from 'joi';

export const environmentValidationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  APP_PUBLIC_URL: Joi.string()
    .allow('')
    .optional()
    .description('Public base URL of this API (used for asset URLs)'),
  CORS_ALLOWED_ORIGINS: Joi.string()
    .allow('')
    .optional()
    .description('Comma-separated allowed origins'),

  // Database
  DATABASE_URL: Joi.string().required().description('PostgreSQL connection string'),

  // Object storage (S3-compatible — Railway bucket)
  STORAGE_ENDPOINT: Joi.string().allow('').optional().description('S3-compatible endpoint URL'),
  STORAGE_BUCKET: Joi.string().allow('').optional().description('Bucket name'),
  STORAGE_ACCESS_KEY_ID: Joi.string().allow('').optional().description('S3 access key ID'),
  STORAGE_SECRET_ACCESS_KEY: Joi.string().allow('').optional().description('S3 secret access key'),
  STORAGE_REGION: Joi.string().allow('').optional().default('auto').description('S3 region'),

  // SMTP (Email)
  SMTP_HOST: Joi.string().allow('').optional().description('SMTP server hostname'),
  SMTP_PORT: Joi.number().default(587).description('SMTP port (587 for TLS, 465 for SSL)'),
  SMTP_USER: Joi.string().allow('').optional().description('SMTP username/email'),
  SMTP_PASS: Joi.string().allow('').optional().description('SMTP password'),
  SMTP_FROM: Joi.string().allow('').optional().description('From email address'),

  // Authentication
  JWT_SECRET: Joi.string().required().min(32).description('JWT signing secret'),
  JWT_EXPIRES_IN: Joi.string().default('7d').description('JWT expiration time'),

  // AI Services
  OPENAI_API_KEY: Joi.string().allow('').optional().description('OpenAI API key for AI features'),
  ANTHROPIC_API_KEY: Joi.string().allow('').optional().description('Anthropic API key for Claude'),
  GOOGLE_AI_API_KEY: Joi.string().allow('').optional().description('Google AI API key for Gemini'),
  NINEROUTER_URL: Joi.string()
    .uri()
    .default('https://9router-dev.up.railway.app')
    .description('9router OpenAI-compatible gateway base URL'),
  NINEROUTER_KEY: Joi.string().allow('').optional().description('9router API key (Bearer token)'),
  LANGFUSE_PUBLIC_KEY: Joi.string()
    .allow('')
    .optional()
    .description('Langfuse public key for monitoring'),
  LANGFUSE_SECRET_KEY: Joi.string().allow('').optional().description('Langfuse secret key'),
  LANGFUSE_HOST: Joi.string().allow('').optional().default('https://cloud.langfuse.com'),
  LANGFUSE_BASE_URL: Joi.string().allow('').optional(),

  // Monitoring
  SENTRY_DSN: Joi.string().allow('').optional().description('Sentry DSN for error tracking'),

  // RevenueCat
  REVENUECAT_API_KEY: Joi.string().allow('').optional().description('RevenueCat API key'),
  REVENUECAT_WEBHOOK_SECRET: Joi.string()
    .allow('')
    .optional()
    .description('RevenueCat webhook secret'),
  REVENUECAT_REST_API_KEY: Joi.string()
    .allow('')
    .optional()
    .description(
      'RevenueCat REST API secret key for subscriber lookups (fallback + reconciliation)',
    ),

  // Firebase
  FIREBASE_PROJECT_ID: Joi.string().allow('').optional().description('Firebase project ID'),
  FIREBASE_CLIENT_EMAIL: Joi.string()
    .allow('')
    .optional()
    .description('Firebase service account email'),
  FIREBASE_PRIVATE_KEY: Joi.string()
    .allow('')
    .optional()
    .description('Firebase service account private key'),
});
