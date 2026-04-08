// Load .env before any SDK reads process.env
import 'dotenv/config';

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import * as Sentry from '@sentry/node';
import { SentrySpanProcessor } from '@sentry/opentelemetry';

// Ensure LANGFUSE_BASE_URL is set for all Langfuse packages
if (!process.env.LANGFUSE_BASE_URL) {
  process.env.LANGFUSE_BASE_URL = process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com';
}

const langfuseEnabled = !!process.env.LANGFUSE_PUBLIC_KEY && !!process.env.LANGFUSE_SECRET_KEY;
const sentryEnabled = !!process.env.SENTRY_DSN;

// Init Sentry first with skipOpenTelemetrySetup so we control OTel below.
// This avoids competing with Langfuse's NodeSDK for the global OTel provider.
if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 1.0,
    sendDefaultPii: true,
    skipOpenTelemetrySetup: true, // We register Sentry's span processor in NodeSDK below
    integrations: [
      Sentry.consoleLoggingIntegration(), // Forward console logs to Sentry Logs
    ],
  });
  console.log(`Sentry enabled → env:${process.env.NODE_ENV || 'development'}`);
} else {
  console.log('Sentry disabled (missing SENTRY_DSN)');
}

// Single NodeSDK with all span processors — avoids OTel global provider conflicts
const spanProcessors = [];

if (langfuseEnabled) {
  spanProcessors.push(new LangfuseSpanProcessor());
  console.log(`Langfuse tracing enabled → ${process.env.LANGFUSE_BASE_URL}`);
} else {
  console.log('Langfuse tracing disabled (missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY)');
}

if (sentryEnabled) {
  spanProcessors.push(new SentrySpanProcessor());
}

let langfuseSdk: NodeSDK | undefined;

if (spanProcessors.length > 0) {
  langfuseSdk = new NodeSDK({ spanProcessors });
  langfuseSdk.start();
}

export { langfuseSdk };
