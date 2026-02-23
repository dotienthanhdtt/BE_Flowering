import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to add flag_url column to languages table
 * and seed/update language data with flag URLs from Supabase storage
 */
export class AddFlagUrlToLanguages1738678400000 implements MigrationInterface {
  name = 'AddFlagUrlToLanguages1738678400000';

  // Supabase storage base URL for language flags
  private readonly storageBaseUrl =
    'https://wkmpdtbubvhusxmbpclj.supabase.co/storage/v1/object/public/language_flag';

  // Language data matching flags in Supabase storage (uk, cn, de, es, fr, jp, kr)
  private readonly languageData = [
    { code: 'uk', name: 'English (UK)', nativeName: 'English', flagCode: 'uk' },
    { code: 'cn', name: 'Chinese', nativeName: '中文', flagCode: 'cn' },
    { code: 'de', name: 'German', nativeName: 'Deutsch', flagCode: 'de' },
    { code: 'es', name: 'Spanish', nativeName: 'Español', flagCode: 'es' },
    { code: 'fr', name: 'French', nativeName: 'Français', flagCode: 'fr' },
    { code: 'jp', name: 'Japanese', nativeName: '日本語', flagCode: 'jp' },
    { code: 'kr', name: 'Korean', nativeName: '한국어', flagCode: 'kr' },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add flag_url column
    await queryRunner.query(`
      ALTER TABLE "languages" ADD COLUMN "flag_url" TEXT;
    `);

    // Update existing languages with flag URLs, or insert if not exists
    for (const lang of this.languageData) {
      const flagUrl = `${this.storageBaseUrl}/${lang.flagCode}.png`;

      await queryRunner.query(
        `
        INSERT INTO "languages" ("code", "name", "native_name", "flag_url", "is_active")
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT ("code")
        DO UPDATE SET "flag_url" = EXCLUDED."flag_url", "is_active" = true;
      `,
        [lang.code, lang.name, lang.nativeName, flagUrl],
      );
    }

    // Set is_active = false for languages without flag mapping
    const mappedCodes = this.languageData.map((l) => l.code);
    await queryRunner.query(
      `
      UPDATE "languages" SET "is_active" = false
      WHERE "code" NOT IN (${mappedCodes.map((_, i) => `$${i + 1}`).join(', ')});
    `,
      mappedCodes,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove flag_url column
    await queryRunner.query(`
      ALTER TABLE "languages" DROP COLUMN "flag_url";
    `);

    // Re-enable all languages (revert is_active changes)
    await queryRunner.query(`
      UPDATE "languages" SET "is_active" = true;
    `);
  }
}
