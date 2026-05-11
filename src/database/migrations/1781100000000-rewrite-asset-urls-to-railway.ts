import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rewrites image URLs that pointed at the old Supabase Storage public buckets
 * to the new object-storage bucket, served via the app's `/assets/*` passthrough.
 * The images themselves were copied to the new bucket under the same paths
 * (with the `lessones` bucket renamed to `lessons`).
 *
 * NOTE: the target host is taken from `APP_PUBLIC_URL` at migration time
 * (falls back to http://localhost:3000) — set that env var before running this
 * against a deployed environment, otherwise the rows will hold localhost URLs.
 */
export class RewriteAssetUrlsToRailway1781100000000 implements MigrationInterface {
  name = 'RewriteAssetUrlsToRailway1781100000000';

  private readonly oldBase = 'https://wkmpdtbubvhusxmbpclj.supabase.co/storage/v1/object/public';

  private base(): string {
    return (process.env.APP_PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const base = this.base();
    // languages.flag_url : language_flag/<file>
    await queryRunner.query(
      `UPDATE "languages" SET "flag_url" = REPLACE("flag_url", $1, $2) WHERE "flag_url" LIKE $3`,
      [
        `${this.oldBase}/language_flag/`,
        `${base}/assets/language_flag/`,
        `${this.oldBase}/language_flag/%`,
      ],
    );
    // scenarios.image_url : lessones/<file>  ->  lessons/<file>
    await queryRunner.query(
      `UPDATE "scenarios" SET "image_url" = REPLACE("image_url", $1, $2) WHERE "image_url" LIKE $3`,
      [`${this.oldBase}/lessones/`, `${base}/assets/lessons/`, `${this.oldBase}/lessones/%`],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const base = this.base();
    await queryRunner.query(
      `UPDATE "languages" SET "flag_url" = REPLACE("flag_url", $1, $2) WHERE "flag_url" LIKE $3`,
      [
        `${base}/assets/language_flag/`,
        `${this.oldBase}/language_flag/`,
        `${base}/assets/language_flag/%`,
      ],
    );
    await queryRunner.query(
      `UPDATE "scenarios" SET "image_url" = REPLACE("image_url", $1, $2) WHERE "image_url" LIKE $3`,
      [`${base}/assets/lessons/`, `${this.oldBase}/lessones/`, `${base}/assets/lessons/%`],
    );
  }
}
