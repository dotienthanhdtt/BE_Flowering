export const VOCAB_INJECTION_CONFIG = Object.freeze({
  totalWords: 10,
  recentBucketSize: 5,
  srsBucketSize: 5,
  maxBoxForSrs: 4,
  maxBoxForRotation: 4,
});

export type VocabInjectionConfig = typeof VOCAB_INJECTION_CONFIG;
