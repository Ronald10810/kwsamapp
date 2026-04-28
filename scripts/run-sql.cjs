#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const sqlArg = process.argv[2];
if (!sqlArg) {
  console.error('Usage: node scripts/run-sql.cjs <path-to-sql-file>');
  process.exit(1);
}

const sqlPath = path.isAbsolute(sqlArg) ? sqlArg : path.join(process.cwd(), sqlArg);
if (!fs.existsSync(sqlPath)) {
  console.error(`SQL file not found: ${sqlPath}`);
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

(async () => {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log(`[sql] Executing ${sqlArg}`);
    await client.query(sql);
    console.log('[sql] Done');
  } finally {
    await client.end();
  }
})().catch(err => {
  console.error('[sql] Failed:', err.message);
  process.exit(1);
});
