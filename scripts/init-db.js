require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db/db');

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set in .env');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    // All schema upgrades succeed together, or PostgreSQL rolls them back.
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('NetworX database migration complete. Existing users and legacy tables were preserved.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
})().catch((error) => {
  console.error('Database setup failed:', error.code || '', error.message);
  console.error('The migration was rolled back; do not delete any database tables.');
  process.exitCode = 1;
}).finally(() => pool.end());
