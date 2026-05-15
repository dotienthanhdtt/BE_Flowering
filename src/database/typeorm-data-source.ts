import { DataSource } from 'typeorm';
import { join } from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

// Railway-managed Postgres (internal network or TCP proxy) does not serve TLS;
// only enable SSL for externally hosted databases.
const requiresSsl = !!databaseUrl && !/\.railway\.internal|\.rlwy\.net/.test(databaseUrl);

// Resolve entity/migration globs relative to this file so the same data source
// works for the dev CLI (ts-node, loads .ts) and the prod container (node,
// loads compiled .js from dist/).
const ext = __filename.endsWith('.ts') ? 'ts' : 'js';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  ssl: requiresSsl ? { rejectUnauthorized: false } : false,
  entities: [join(__dirname, `entities/*.entity.${ext}`)],
  migrations: [join(__dirname, `migrations/*.${ext}`)],
  synchronize: false,
  logging: true,
});
