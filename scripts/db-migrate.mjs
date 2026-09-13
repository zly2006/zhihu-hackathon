import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';

const url = process.env.LAMPLIGHT_MIGRATION_DATABASE_URL || process.env.LAMPLIGHT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('缺少 LAMPLIGHT_DATABASE_URL（或 DATABASE_URL）。'); process.exit(2); }
const pool = new Pool({connectionString: url, max: 1, ssl: process.env.LAMPLIGHT_DATABASE_SSL === 'require' ? {rejectUnauthorized: false} : undefined});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const version = '001_initial';
  const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [version]);
  if (!existing.rowCount) {
    const sql = await readFile(new URL('../db/migrations/001_initial.sql', import.meta.url), 'utf8');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    console.log(`已应用迁移 ${version}`);
  } else console.log(`迁移 ${version} 已存在`);
  await client.query('COMMIT');
} catch (error) { await client.query('ROLLBACK').catch(() => undefined); console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
finally { client.release(); await pool.end(); }
