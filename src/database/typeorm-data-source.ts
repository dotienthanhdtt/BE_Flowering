import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

// Railway-managed Postgres (internal network or TCP proxy) does not serve TLS;
// only enable SSL for externally hosted databases.
const requiresSsl = !!databaseUrl && !/\.railway\.internal|\.rlwy\.net/.test(databaseUrl);

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  ssl: requiresSsl ? { rejectUnauthorized: false } : false,
  entities: ['src/database/entities/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: true,
});
