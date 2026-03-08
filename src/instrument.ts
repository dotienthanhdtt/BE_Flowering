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
