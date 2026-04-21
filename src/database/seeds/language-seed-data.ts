import { FrameworkCode } from '../../common/constants/language-levels';

export interface LanguageSeedData {
  code: string;
  name: string;
  nativeName: string;
  levelFramework: FrameworkCode | null;
}

export const languageSeedData: LanguageSeedData[] = [
  { code: 'en', name: 'English', nativeName: 'English', levelFramework: 'CEFR' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', levelFramework: null },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', levelFramework: 'JLPT' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', levelFramework: 'TOPIK' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', levelFramework: 'HSK' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', levelFramework: 'CEFR' },
  { code: 'fr', name: 'French', nativeName: 'Français', levelFramework: 'CEFR' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', levelFramework: 'CEFR' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', levelFramework: 'CEFR' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', levelFramework: null },
];

export const seedLanguagesQuery = `
  INSERT INTO "languages" ("code", "name", "native_name", "is_active", "level_framework")
  VALUES
    ('en', 'English',    'English',    true, 'CEFR'),
    ('vi', 'Vietnamese', 'Tiếng Việt', true, NULL),
    ('ja', 'Japanese',   '日本語',      true, 'JLPT'),
    ('ko', 'Korean',     '한국어',      true, 'TOPIK'),
    ('zh', 'Chinese',    '中文',       true, 'HSK'),
    ('es', 'Spanish',    'Español',   true, 'CEFR'),
    ('fr', 'French',     'Français',  true, 'CEFR'),
    ('de', 'German',     'Deutsch',   true, 'CEFR'),
    ('pt', 'Portuguese', 'Português', true, 'CEFR'),
    ('th', 'Thai',       'ไทย',        true, NULL)
  ON CONFLICT ("code") DO UPDATE SET level_framework = EXCLUDED.level_framework;
`;
