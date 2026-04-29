import { mapGenericToFramework } from './language-levels';

describe('language-levels', () => {
  describe('mapGenericToFramework', () => {
    const GENERICS = ['beginner', 'elementary', 'intermediate', 'upper_intermediate', 'advanced'];
    const EXPECTED: Record<string, Record<string, string>> = {
      beginner: { CEFR: 'A1', JLPT: 'N5', HSK: 'HSK1', TOPIK: 'TOPIK1', FRAMEWORKLESS: 'beginner' },
      elementary: { CEFR: 'A2', JLPT: 'N4', HSK: 'HSK2', TOPIK: 'TOPIK2', FRAMEWORKLESS: 'beginner' },
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

    GENERICS.forEach((generic) => {
      (['CEFR', 'JLPT', 'HSK', 'TOPIK', 'FRAMEWORKLESS'] as const).forEach((fw) => {
        it(`maps '${generic}' + ${fw} → '${EXPECTED[generic][fw]}'`, () => {
          expect(mapGenericToFramework(fw, generic)).toBe(EXPECTED[generic][fw]);
        });
      });
    });

    it('throws on unknown generic level', () => {
      expect(() => mapGenericToFramework('CEFR', 'master')).toThrow(
        "Unknown generic level 'master'",
      );
    });

    it('throws on unknown framework', () => {
      expect(() => mapGenericToFramework('XYZ', 'beginner')).toThrow("Unknown framework 'XYZ'");
    });
  });
});
