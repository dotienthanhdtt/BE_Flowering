import {
  LANGUAGE_FRAMEWORKS,
  isValidLevel,
  mapUserLevelToContentDifficulty,
  mapGenericToFramework,
} from './language-levels';

describe('language-levels', () => {
  describe('isValidLevel', () => {
    it('accepts all canonical CEFR levels', () => {
      ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].forEach((l) =>
        expect(isValidLevel('CEFR', l)).toBe(true),
      );
    });

    it('accepts all canonical JLPT levels', () => {
      ['N5', 'N4', 'N3', 'N2', 'N1'].forEach((l) =>
        expect(isValidLevel('JLPT', l)).toBe(true),
      );
    });

    it('accepts all canonical HSK levels', () => {
      ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'].forEach((l) =>
        expect(isValidLevel('HSK', l)).toBe(true),
      );
    });

    it('accepts all canonical TOPIK levels', () => {
      ['TOPIK1', 'TOPIK2', 'TOPIK3', 'TOPIK4', 'TOPIK5', 'TOPIK6'].forEach((l) =>
        expect(isValidLevel('TOPIK', l)).toBe(true),
      );
    });

    it('accepts all canonical GENERIC levels', () => {
      ['beginner', 'elementary', 'intermediate', 'upper_intermediate', 'advanced'].forEach((l) =>
        expect(isValidLevel('GENERIC', l)).toBe(true),
      );
    });

    it('rejects cross-framework levels', () => {
      expect(isValidLevel('CEFR', 'N3')).toBe(false);
      expect(isValidLevel('JLPT', 'B1')).toBe(false);
      expect(isValidLevel('HSK', 'TOPIK3')).toBe(false);
    });

    it('rejects garbage strings', () => {
      expect(isValidLevel('CEFR', 'X9')).toBe(false);
      expect(isValidLevel('JLPT', 'beginner')).toBe(false);
    });
  });

  describe('mapUserLevelToContentDifficulty', () => {
    it('maps CEFR levels correctly', () => {
      expect(mapUserLevelToContentDifficulty('CEFR', 'A1')).toBe('beginner');
      expect(mapUserLevelToContentDifficulty('CEFR', 'A2')).toBe('beginner');
      expect(mapUserLevelToContentDifficulty('CEFR', 'B1')).toBe('intermediate');
      expect(mapUserLevelToContentDifficulty('CEFR', 'B2')).toBe('intermediate');
      expect(mapUserLevelToContentDifficulty('CEFR', 'C1')).toBe('advanced');
      expect(mapUserLevelToContentDifficulty('CEFR', 'C2')).toBe('advanced');
    });

    it('maps JLPT levels correctly', () => {
      expect(mapUserLevelToContentDifficulty('JLPT', 'N5')).toBe('beginner');
      expect(mapUserLevelToContentDifficulty('JLPT', 'N4')).toBe('beginner');
      expect(mapUserLevelToContentDifficulty('JLPT', 'N3')).toBe('intermediate');
      expect(mapUserLevelToContentDifficulty('JLPT', 'N2')).toBe('advanced');
      expect(mapUserLevelToContentDifficulty('JLPT', 'N1')).toBe('advanced');
    });

    it('maps HSK levels correctly', () => {
      expect(mapUserLevelToContentDifficulty('HSK', 'HSK1')).toBe('beginner');
      expect(mapUserLevelToContentDifficulty('HSK', 'HSK2')).toBe('beginner');
      expect(mapUserLevelToContentDifficulty('HSK', 'HSK3')).toBe('intermediate');
      expect(mapUserLevelToContentDifficulty('HSK', 'HSK4')).toBe('intermediate');
      expect(mapUserLevelToContentDifficulty('HSK', 'HSK5')).toBe('advanced');
      expect(mapUserLevelToContentDifficulty('HSK', 'HSK6')).toBe('advanced');
    });

    it('maps TOPIK levels correctly', () => {
      expect(mapUserLevelToContentDifficulty('TOPIK', 'TOPIK1')).toBe('beginner');
      expect(mapUserLevelToContentDifficulty('TOPIK', 'TOPIK2')).toBe('beginner');
      expect(mapUserLevelToContentDifficulty('TOPIK', 'TOPIK3')).toBe('intermediate');
      expect(mapUserLevelToContentDifficulty('TOPIK', 'TOPIK4')).toBe('intermediate');
      expect(mapUserLevelToContentDifficulty('TOPIK', 'TOPIK5')).toBe('advanced');
      expect(mapUserLevelToContentDifficulty('TOPIK', 'TOPIK6')).toBe('advanced');
    });

    it('maps GENERIC levels correctly', () => {
      expect(mapUserLevelToContentDifficulty('GENERIC', 'beginner')).toBe('beginner');
      expect(mapUserLevelToContentDifficulty('GENERIC', 'elementary')).toBe('beginner');
      expect(mapUserLevelToContentDifficulty('GENERIC', 'intermediate')).toBe('intermediate');
      expect(mapUserLevelToContentDifficulty('GENERIC', 'upper_intermediate')).toBe('intermediate');
      expect(mapUserLevelToContentDifficulty('GENERIC', 'advanced')).toBe('advanced');
    });

    it('throws on unknown level', () => {
      expect(() => mapUserLevelToContentDifficulty('CEFR', 'X9')).toThrow(
        "Unknown level 'X9' for framework 'CEFR'",
      );
    });
  });

  describe('mapGenericToFramework', () => {
    const GENERICS = ['beginner', 'elementary', 'intermediate', 'upper_intermediate', 'advanced'];
    const EXPECTED: Record<string, Record<string, string>> = {
      beginner: { CEFR: 'A1', JLPT: 'N5', HSK: 'HSK1', TOPIK: 'TOPIK1', GENERIC: 'beginner' },
      elementary: { CEFR: 'A2', JLPT: 'N4', HSK: 'HSK2', TOPIK: 'TOPIK2', GENERIC: 'elementary' },
      intermediate: { CEFR: 'B1', JLPT: 'N3', HSK: 'HSK3', TOPIK: 'TOPIK3', GENERIC: 'intermediate' },
      upper_intermediate: { CEFR: 'B2', JLPT: 'N2', HSK: 'HSK4', TOPIK: 'TOPIK4', GENERIC: 'upper_intermediate' },
      advanced: { CEFR: 'C1', JLPT: 'N1', HSK: 'HSK6', TOPIK: 'TOPIK6', GENERIC: 'advanced' },
    };

    GENERICS.forEach((generic) => {
      (['CEFR', 'JLPT', 'HSK', 'TOPIK', 'GENERIC'] as const).forEach((fw) => {
        it(`maps '${generic}' + ${fw} → '${EXPECTED[generic][fw]}'`, () => {
          expect(mapGenericToFramework(fw, generic)).toBe(EXPECTED[generic][fw]);
        });
      });
    });

    it('throws on unknown generic level', () => {
      expect(() => mapGenericToFramework('CEFR', 'master')).toThrow("Unknown generic level 'master'");
    });
  });

  describe('LANGUAGE_FRAMEWORKS registry completeness', () => {
    it('has correct level counts per framework', () => {
      expect(LANGUAGE_FRAMEWORKS.CEFR).toHaveLength(6);
      expect(LANGUAGE_FRAMEWORKS.JLPT).toHaveLength(5);
      expect(LANGUAGE_FRAMEWORKS.HSK).toHaveLength(6);
      expect(LANGUAGE_FRAMEWORKS.TOPIK).toHaveLength(6);
      expect(LANGUAGE_FRAMEWORKS.GENERIC).toHaveLength(5);
    });
  });
});
