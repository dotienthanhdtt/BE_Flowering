// Load .env before any SDK reads process.env
import 'dotenv/config';

// Sentry must be initialized before other app imports
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  enabled: !!process.env.SENTRY_DSN,
  sendDefaultPii: true,
});

// Langfuse v5 OTel tracing — must init before NestJS bootstrap
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

// Ensure LANGFUSE_BASE_URL is set for all Langfuse packages (CallbackHandler reads env vars)
if (!process.env.LANGFUSE_BASE_URL) {
  process.env.LANGFUSE_BASE_URL =
    process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com';
}

const langfuseBaseUrl = process.env.LANGFUSE_BASE_URL;

const langfuseEnabled =
  !!process.env.LANGFUSE_PUBLIC_KEY && !!process.env.LANGFUSE_SECRET_KEY;

let langfuseSpanProcessor: LangfuseSpanProcessor | undefined;

if (langfuseEnabled) {
  langfuseSpanProcessor = new LangfuseSpanProcessor({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    baseUrl: langfuseBaseUrl,
    // v5 default filter drops non-LLM scopes; export all to capture CallbackHandler spans
    shouldExportSpan: () => true,
  });
  const provider = new NodeTracerProvider({
    spanProcessors: [langfuseSpanProcessor],
  });
  provider.register();
  console.log(`Langfuse tracing enabled → ${langfuseBaseUrl}`);
} else {
  console.log('Langfuse tracing disabled (missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY)');
}

export { langfuseSpanProcessor };
