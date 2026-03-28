// Sentry must be initialized before any other imports
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  // Performance monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  // Only enable if DSN is configured
  enabled: !!process.env.SENTRY_DSN,
  sendDefaultPii: true,
});

// Langfuse v5 OTel tracing — must init before NestJS bootstrap
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

// Map LANGFUSE_HOST → LANGFUSE_BASE_URL for backward compatibility
if (process.env.LANGFUSE_HOST && !process.env.LANGFUSE_BASE_URL) {
  process.env.LANGFUSE_BASE_URL = process.env.LANGFUSE_HOST;
}

const langfuseEnabled =
  !!process.env.LANGFUSE_PUBLIC_KEY && !!process.env.LANGFUSE_SECRET_KEY;

if (langfuseEnabled) {
  const provider = new NodeTracerProvider({
    spanProcessors: [new LangfuseSpanProcessor()],
  });
  provider.register();
}
