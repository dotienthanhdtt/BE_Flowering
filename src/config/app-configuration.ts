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
  oauth: {
    google: {
      clientId: string;
      clientSecret: string;
      callbackUrl: string;
    };
    apple: {
      clientId: string;
    };
  };
  ai: {
    openaiApiKey?: string;
    anthropicApiKey?: string;
    googleAiApiKey?: string;
    langfusePublicKey?: string;
    langfuseSecretKey?: string;
    langfuseHost: string;
  };
  sentry: {
    dsn?: string;
  };
  revenuecat: {
    apiKey?: string;
    webhookSecret?: string;
  };
  firebase: {
    projectId?: string;
    clientEmail?: string;
    privateKey?: string;
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
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  },
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackUrl: process.env.GOOGLE_CALLBACK_URL || '',
    },
    apple: {
      clientId: process.env.APPLE_CLIENT_ID || '',
    },
  },
  ai: {
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    googleAiApiKey: process.env.GOOGLE_AI_API_KEY,
    langfusePublicKey: process.env.LANGFUSE_PUBLIC_KEY,
    langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY,
    langfuseHost: process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
  },
  sentry: {
    dsn: process.env.SENTRY_DSN,
  },
  revenuecat: {
    apiKey: process.env.REVENUECAT_API_KEY,
    webhookSecret: process.env.REVENUECAT_WEBHOOK_SECRET,
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  },
});
