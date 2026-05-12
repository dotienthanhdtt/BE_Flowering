// Load .env before any SDK reads process.env
import 'dotenv/config';

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

// Ensure LANGFUSE_BASE_URL is set for all Langfuse packages
if (!process.env.LANGFUSE_BASE_URL) {
  process.env.LANGFUSE_BASE_URL = process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com';
}

const langfuseEnabled = !!process.env.LANGFUSE_PUBLIC_KEY && !!process.env.LANGFUSE_SECRET_KEY;

let langfuseSdk: NodeSDK | undefined;

if (langfuseEnabled) {
  langfuseSdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
  langfuseSdk.start();
  console.log(`Langfuse tracing enabled → ${process.env.LANGFUSE_BASE_URL}`);
} else {
  console.log('Langfuse tracing disabled (missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY)');
}

export { langfuseSdk };
