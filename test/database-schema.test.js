const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// This is a static verification. A real PostgreSQL connection is still needed
// to validate the target user's local database.
const schema = fs.readFileSync(path.resolve(__dirname, '../db/schema.sql'), 'utf8');

test('all backend feature tables are created without destructive operations', () => {
  for (const name of ['users', 'posts', 'post_likes', 'comments', 'networx_connections', 'notifications', 'experiences', 'educations']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${name}\\b`));
  }
  assert.doesNotMatch(schema, /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i);
  assert.doesNotMatch(schema, /\bTRUNCATE\s+TABLE\b/i);
});

test('existing user accounts are upgraded in place', () => {
  assert.match(schema, /ALTER TABLE users/);
  for (const col of ['type', 'headline', 'profile_picture', 'cover_pic', 'about', 'location', 'skills', 'isverified', 'isbrand', 'created_at', 'updated_at']) {
    assert.match(schema, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
  }
});


test('legacy posts are migrated in place without deleting their id or owner', () => {
  assert.match(schema, /ADD COLUMN IF NOT EXISTS post_id UUID/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS user_id UUID/);
  assert.match(schema, /UPDATE posts SET post_id=id WHERE post_id IS NULL/);
  assert.match(schema, /UPDATE posts SET user_id=owner WHERE user_id IS NULL/);
  assert.match(schema, /networx_sync_legacy_post_trigger/);
  assert.match(schema, /ALTER COLUMN media_url TYPE TEXT/);
});

test('legacy connections and requests are imported into a separate compatible table', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS networx_connections/);
  assert.match(schema, /FROM connection_requests/);
  assert.match(schema, /FROM connections c/);
  assert.doesNotMatch(schema, /ALTER TABLE connections/);
});


test('legacy post likes are imported from UUID arrays without clearing source data', () => {
  assert.match(schema, /unnest\(p\.liked_by\)/);
  assert.match(schema, /INSERT INTO post_likes/);
});
