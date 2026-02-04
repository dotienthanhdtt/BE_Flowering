import * as Joi from 'joi';

export const environmentValidationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  CORS_ALLOWED_ORIGINS: Joi.string()
    .allow('')
    .optional()
    .description('Comma-separated allowed origins'),

  // Database (Supabase)
  DATABASE_URL: Joi.string().required().description('Supabase PostgreSQL connection string'),
  SUPABASE_URL: Joi.string().required().description('Supabase project URL'),
  SUPABASE_ANON_KEY: Joi.string().required().description('Supabase anonymous key'),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().required().description('Supabase service role key'),

  // Authentication
  JWT_SECRET: Joi.string().required().min(32).description('JWT signing secret'),
  JWT_EXPIRES_IN: Joi.string().default('7d').description('JWT expiration time'),

  // AI Services
  OPENAI_API_KEY: Joi.string().allow('').optional().description('OpenAI API key for AI features'),
  ANTHROPIC_API_KEY: Joi.string().allow('').optional().description('Anthropic API key for Claude'),
  GOOGLE_AI_API_KEY: Joi.string().allow('').optional().description('Google AI API key for Gemini'),
  LANGFUSE_PUBLIC_KEY: Joi.string()
    .allow('')
    .optional()
    .description('Langfuse public key for monitoring'),
  LANGFUSE_SECRET_KEY: Joi.string().allow('').optional().description('Langfuse secret key'),
  LANGFUSE_HOST: Joi.string().allow('').optional().default('https://cloud.langfuse.com'),

  // Monitoring
  SENTRY_DSN: Joi.string().allow('').optional().description('Sentry DSN for error tracking'),

  // RevenueCat
  REVENUECAT_API_KEY: Joi.string().allow('').optional().description('RevenueCat API key'),
  REVENUECAT_WEBHOOK_SECRET: Joi.string()
    .allow('')
    .optional()
    .description('RevenueCat webhook secret'),

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
