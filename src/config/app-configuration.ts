export interface AppConfiguration {
  nodeEnv: string;
  port: number;
  corsOrigins: string;
  database: {
    url: string;
    supabaseUrl: string;
    supabaseAnonKey: string;
    supabaseServiceRoleKey: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  ai: {
    openaiApiKey?: string;
    langfusePublicKey?: string;
    langfuseSecretKey?: string;
    langfuseHost: string;
  };
  sentry: {
    dsn?: string;
  };
}

export default (): AppConfiguration => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  corsOrigins: process.env.CORS_ALLOWED_ORIGINS || '',
  database: {
    url: process.env.DATABASE_URL || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
  jwt: {
    secret: process.env.JWT_SECRET || '',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  ai: {
    openaiApiKey: process.env.OPENAI_API_KEY,
    langfusePublicKey: process.env.LANGFUSE_PUBLIC_KEY,
    langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY,
    langfuseHost: process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
  },
  sentry: {
    dsn: process.env.SENTRY_DSN,
  },
});
