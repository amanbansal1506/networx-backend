const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plain, validEmail, validUrl, pageArgs, safeProfile, formatPost, isUuid } = require('../utils/helpers');

test('normalizes text and validates email, URL', () => {
  assert.equal(plain('  good  '), 'good');
  assert.equal(plain(3), '');
  assert.equal(validEmail('test@example.com'), true);
  assert.equal(validEmail('not-an-email'), false);
  assert.equal(validUrl('https://images.example.com/pic.png'), true);
  assert.equal(validUrl('javascript:alert(1)'), false);
});

test('paginates safely', () => {
  assert.deepEqual(pageArgs({ page: '3', limit: '10' }), { page: 3, limit: 10, offset: 20 });
  assert.throws(() => pageArgs({ limit: '9999' }), /page must/);
  assert.throws(() => pageArgs({ page: '-1' }), /page must/);
});

test('never returns a password hash', () => {
  const safe = safeProfile({ user_id: 'user-1', username: 'demo', password: 'hash' });
  assert.equal(safe.id, 'user-1');
  assert.equal(Object.hasOwn(safe, 'password'), false);
});

test('normalizes post response and counts', () => {
  const post = formatPost({ post_id: 'p', user_id: 'u', content: 'Hey', author_username: 'demo', likes_count: '3', is_liked: true });
  assert.equal(post.id, 'p');
  assert.equal(post.likes_count, 3);
  assert.equal(post.is_liked, true);
  assert.equal(post.author.username, 'demo');
});

test('requires actual UUID format', () => {
  assert.equal(isUuid('e6d6a765-fc13-443b-8c64-82ee8a9ac003'), true);
  assert.equal(isUuid('../admin'), false);
});
