export interface LanguageSeedData {
  code: string;
  name: string;
  nativeName: string;
}

export const languageSeedData: LanguageSeedData[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
];

export const seedLanguagesQuery = `
  INSERT INTO "languages" ("code", "name", "native_name", "is_active")
  VALUES
    ('en', 'English', 'English', true),
    ('vi', 'Vietnamese', 'Tiếng Việt', true),
    ('ja', 'Japanese', '日本語', true),
    ('ko', 'Korean', '한국어', true),
    ('zh', 'Chinese', '中文', true),
    ('es', 'Spanish', 'Español', true),
    ('fr', 'French', 'Français', true),
    ('de', 'German', 'Deutsch', true),
    ('pt', 'Portuguese', 'Português', true),
    ('th', 'Thai', 'ไทย', true)
  ON CONFLICT ("code") DO NOTHING;
`;
