require('dotenv').config();
const pool = require('../db/db');

// This is read-only. It tells you which tables/columns are missing in the
// actual database in DATABASE_URL. It never prints credentials or user data.
const expected = {
  users: ['user_id', 'username', 'full_name', 'email', 'password', 'type', 'headline', 'profile_picture', 'cover_pic', 'about', 'website', 'industry', 'companysize', 'hq', 'location', 'skills', 'isverified', 'isbrand', 'created_at', 'updated_at'],
  posts: ['post_id', 'user_id', 'content', 'media_url', 'visibility', 'created_at', 'updated_at'],
  post_likes: ['post_id', 'user_id', 'created_at'],
  comments: ['comment_id', 'post_id', 'user_id', 'content', 'created_at', 'updated_at'],
  networx_connections: ['connection_id', 'requester_id', 'recipient_id', 'status', 'created_at', 'updated_at'],
  notifications: ['notification_id', 'user_id', 'actor_id', 'type', 'entity_id', 'message', 'is_read', 'created_at'],
  experiences: ['experience_id', 'user_id', 'title', 'company', 'location', 'start_date', 'end_date', 'is_current', 'description', 'created_at'],
  educations: ['education_id', 'user_id', 'school', 'degree', 'field_of_study', 'start_date', 'end_date', 'description', 'created_at'],
};

// Required type checks help detect incompatible legacy tables where column
// names exist but aren't PostgreSQL UUIDs (for example INTEGER post IDs).
const keyTypes = {
  users: { user_id: 'uuid', skills: '_text' },
  posts: { post_id: 'uuid', user_id: 'uuid', media_url: 'text' },
  post_likes: { post_id: 'uuid', user_id: 'uuid' },
  comments: { comment_id: 'uuid', post_id: 'uuid' },
  networx_connections: { connection_id: 'uuid', requester_id: 'uuid', recipient_id: 'uuid' },
  notifications: { notification_id: 'uuid', user_id: 'uuid' },
  experiences: { experience_id: 'uuid', user_id: 'uuid' },
  educations: { education_id: 'uuid', user_id: 'uuid' },
};

function checkSchema(rows) {
  const byTable = new Map();
  for (const row of rows) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Map());
    byTable.get(row.table_name).set(row.column_name, row.udt_name);
  }
  const issues = [];
  for (const [table, fields] of Object.entries(expected)) {
    const actual = byTable.get(table);
    if (!actual) {
      issues.push(`Missing table: ${table}`);
      continue;
    }
    for (const field of fields) {
      if (!actual.has(field)) issues.push(`Missing column: ${table}.${field}`);
      else if (keyTypes[table]?.[field] && actual.get(field) !== keyTypes[table][field]) {
        issues.push(`Unexpected type: ${table}.${field} is ${actual.get(field)} (expected ${keyTypes[table][field]})`);
      }
    }
  }
  return issues;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing from backend .env');
  const result = await pool.query(
    `SELECT table_name, column_name, udt_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [Object.keys(expected)]
  );
  const issues = checkSchema(result.rows);
  if (issues.length) {
    console.error(`\nDatabase setup needs attention (${issues.length} issue(s)):`);
    for (const issue of issues) console.error(`  - ${issue}`);
    console.error('\nFirst try: npm run repair');
    console.error('Existing custom tables or incompatible column types may need a manual migration. Do NOT drop your users table.');
    process.exitCode = 1;
  } else {
    console.log('Database schema OK: users, posts, likes, comments, network connections, notifications and profile history are ready.');
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Database check failed:', err.message);
    console.error('Check that PostgreSQL is running and DATABASE_URL points to the correct database.');
    process.exitCode = 1;
  }).finally(() => pool.end());
}
module.exports = { expected, checkSchema };
