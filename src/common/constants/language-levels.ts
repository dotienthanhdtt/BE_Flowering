// Mapping of generic onboarding levels → framework-native level codes.
// Lookup-only constants kept here because the mapping is shared domain knowledge
// the AI onboarding flow relies on. Validation and level metadata live in DB
// (`framework_levels`) and are loaded via FrameworkLevelsService.

const GENERIC_TO_FRAMEWORK_MAP: Record<string, Record<string, string>> = {
  beginner: {
    CEFR: 'A1',
    JLPT: 'N5',
    HSK: 'HSK1',
    TOPIK: 'TOPIK1',
    FRAMEWORKLESS: 'beginner',
  },
  elementary: {
    CEFR: 'A2',
    JLPT: 'N4',
    HSK: 'HSK2',
    TOPIK: 'TOPIK2',
    FRAMEWORKLESS: 'beginner',
  },
  intermediate: {
    CEFR: 'B1',
    JLPT: 'N3',
    HSK: 'HSK3',
    TOPIK: 'TOPIK3',
    FRAMEWORKLESS: 'beginner',
  },
  upper_intermediate: {
    CEFR: 'B2',
    JLPT: 'N2',
    HSK: 'HSK4',
    TOPIK: 'TOPIK4',
    FRAMEWORKLESS: 'beginner',
  },
  advanced: {
    CEFR: 'C1',
    JLPT: 'N1',
    HSK: 'HSK6',
    TOPIK: 'TOPIK6',
    FRAMEWORKLESS: 'beginner',
  },
};

export function mapGenericToFramework(framework: string, generic: string): string {
  const mapping = GENERIC_TO_FRAMEWORK_MAP[generic];
  if (!mapping) {
    throw new Error(`Unknown generic level '${generic}'`);
  }
  const result = mapping[framework];
  if (!result) {
    throw new Error(`Unknown framework '${framework}'`);
  }
  return result;
}
