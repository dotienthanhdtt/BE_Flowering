export type FrameworkCode = 'CEFR' | 'JLPT' | 'HSK' | 'TOPIK' | 'GENERIC';

export const LANGUAGE_FRAMEWORKS: Record<FrameworkCode, readonly string[]> = {
  CEFR: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
  JLPT: ['N5', 'N4', 'N3', 'N2', 'N1'],
  HSK: ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'],
  TOPIK: ['TOPIK1', 'TOPIK2', 'TOPIK3', 'TOPIK4', 'TOPIK5', 'TOPIK6'],
  GENERIC: ['beginner', 'elementary', 'intermediate', 'upper_intermediate', 'advanced'],
} as const;

const CONTENT_DIFFICULTY_MAP: Record<
  FrameworkCode,
  Record<string, 'beginner' | 'intermediate' | 'advanced'>
> = {
  CEFR: {
    A1: 'beginner',
    A2: 'beginner',
    B1: 'intermediate',
    B2: 'intermediate',
    C1: 'advanced',
    C2: 'advanced',
  },
  JLPT: { N5: 'beginner', N4: 'beginner', N3: 'intermediate', N2: 'advanced', N1: 'advanced' },
  HSK: {
    HSK1: 'beginner',
    HSK2: 'beginner',
    HSK3: 'intermediate',
    HSK4: 'intermediate',
    HSK5: 'advanced',
    HSK6: 'advanced',
  },
  TOPIK: {
    TOPIK1: 'beginner',
    TOPIK2: 'beginner',
    TOPIK3: 'intermediate',
    TOPIK4: 'intermediate',
    TOPIK5: 'advanced',
    TOPIK6: 'advanced',
  },
  GENERIC: {
    beginner: 'beginner',
    elementary: 'beginner',
    intermediate: 'intermediate',
    upper_intermediate: 'intermediate',
    advanced: 'advanced',
  },
};

// Generic level → framework-native level mapping (migration + onboarding save path)
const GENERIC_TO_FRAMEWORK_MAP: Record<string, Record<FrameworkCode, string>> = {
  beginner: { CEFR: 'A1', JLPT: 'N5', HSK: 'HSK1', TOPIK: 'TOPIK1', GENERIC: 'beginner' },
  elementary: { CEFR: 'A2', JLPT: 'N4', HSK: 'HSK2', TOPIK: 'TOPIK2', GENERIC: 'elementary' },
  intermediate: { CEFR: 'B1', JLPT: 'N3', HSK: 'HSK3', TOPIK: 'TOPIK3', GENERIC: 'intermediate' },
  upper_intermediate: {
    CEFR: 'B2',
    JLPT: 'N2',
    HSK: 'HSK4',
    TOPIK: 'TOPIK4',
    GENERIC: 'upper_intermediate',
  },
  advanced: { CEFR: 'C1', JLPT: 'N1', HSK: 'HSK6', TOPIK: 'TOPIK6', GENERIC: 'advanced' },
};

export function isValidLevel(framework: FrameworkCode, level: string): boolean {
  return (LANGUAGE_FRAMEWORKS[framework] as readonly string[]).includes(level);
}

export function mapUserLevelToContentDifficulty(
  framework: FrameworkCode,
  level: string,
): 'beginner' | 'intermediate' | 'advanced' {
  const result = CONTENT_DIFFICULTY_MAP[framework]?.[level];
  if (!result) {
    throw new Error(`Unknown level '${level}' for framework '${framework}'`);
  }
  return result;
}

export function mapGenericToFramework(framework: FrameworkCode, generic: string): string {
  const mapping = GENERIC_TO_FRAMEWORK_MAP[generic];
  if (!mapping) {
    throw new Error(`Unknown generic level '${generic}'`);
  }
  return mapping[framework];
}
