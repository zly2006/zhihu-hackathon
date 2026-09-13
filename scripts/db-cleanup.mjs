import {Pool} from 'pg';
const url = process.env.LAMPLIGHT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('缺少 LAMPLIGHT_DATABASE_URL（或 DATABASE_URL）。'); process.exit(2); }
const pool = new Pool({connectionString: url, max: 1, ssl: process.env.LAMPLIGHT_DATABASE_SSL === 'require' ? {rejectUnauthorized: false} : undefined});
try { await pool.query('SELECT cleanup_lamplight_demo_data()'); console.log('已清理过期 demo 记录。'); }
finally { await pool.end(); }
