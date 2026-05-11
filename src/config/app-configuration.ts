export interface AppConfiguration {
  nodeEnv: string;
  port: number;
  publicUrl: string;
  corsOrigins: string;
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
  database: {
    url: string;
  };
  storage: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  ai: {
    openaiApiKey?: string;
    anthropicApiKey?: string;
    googleAiApiKey?: string;
    langfusePublicKey?: string;
    langfuseSecretKey?: string;
    langfuseHost: string;
    sttProvider: string;
  };
  sentry: {
    dsn?: string;
  };
  revenuecat: {
    apiKey?: string;
    webhookSecret?: string;
    /** Secret key for RC REST API v1 subscriber lookups (fallback + reconciliation). */
    restApiKey?: string;
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
  publicUrl: process.env.APP_PUBLIC_URL || 'http://localhost:3000',
  corsOrigins: process.env.CORS_ALLOWED_ORIGINS || '',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },
  database: {
    url: process.env.DATABASE_URL || '',
  },
  storage: {
    endpoint: process.env.STORAGE_ENDPOINT || '',
    bucket: process.env.STORAGE_BUCKET || '',
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || '',
    region: process.env.STORAGE_REGION || 'auto',
  },
  jwt: {
    secret: process.env.JWT_SECRET || '',
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  },
  ai: {
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    googleAiApiKey: process.env.GOOGLE_AI_API_KEY,
    langfusePublicKey: process.env.LANGFUSE_PUBLIC_KEY,
    langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY,
    langfuseHost: process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
    sttProvider: process.env.STT_PROVIDER || 'openai',
  },
  sentry: {
    dsn: process.env.SENTRY_DSN,
  },
  revenuecat: {
    apiKey: process.env.REVENUECAT_API_KEY,
    webhookSecret: process.env.REVENUECAT_WEBHOOK_SECRET,
    restApiKey: process.env.REVENUECAT_REST_API_KEY,
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  },
});
