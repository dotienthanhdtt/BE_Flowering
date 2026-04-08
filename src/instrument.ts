// Load .env before any SDK reads process.env
import 'dotenv/config';

// Langfuse v5 OTel tracing — must init BEFORE Sentry (Sentry also registers OTel globals)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

// Ensure LANGFUSE_BASE_URL is set for all Langfuse packages (CallbackHandler reads env vars)
if (!process.env.LANGFUSE_BASE_URL) {
  process.env.LANGFUSE_BASE_URL = process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com';
}

const langfuseEnabled = !!process.env.LANGFUSE_PUBLIC_KEY && !!process.env.LANGFUSE_SECRET_KEY;

let langfuseSdk: NodeSDK | undefined;

if (langfuseEnabled) {
  langfuseSdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
  });
  langfuseSdk.start();
  console.log(`Langfuse tracing enabled → ${process.env.LANGFUSE_BASE_URL}`);
} else {
  console.log('Langfuse tracing disabled (missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY)');
}

// Sentry — only init when DSN is provided (Sentry.init registers OTel globals even when disabled)
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 1.0,
    sendDefaultPii: true,
  });
}

export { langfuseSdk };
