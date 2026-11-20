const crypto = require('node:crypto');

const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const plain = (value) => typeof value === 'string' ? value.trim() : '';
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validUrl = (value) => value == null || value === '' || (typeof value === 'string' && /^https?:\/\//i.test(value) && (() => { try { const url = new URL(value); return !!url.hostname; } catch { return false; } })());
const pageArgs = (query = {}) => {
  const limit = Number(query.limit ?? 20);
  const page = Number(query.page ?? 1);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(page) || page < 1 || page > 10000) {
    const err = new Error('page must be 1-10000 and limit must be 1-50');
    err.status = 400;
    throw err;
  }
  return { limit, page, offset: (page - 1) * limit };
};
const badRequest = (message) => { const err = new Error(message); err.status = 400; throw err; };
const httpError = (status, message) => { const err = new Error(message); err.status = status; throw err; };
const safeProfile = (row) => {
  if (!row) return null;
  const { password, ...safe } = row;
  return { ...safe, id: safe.user_id };
};
const formatPost = (row) => ({
  post_id: row.post_id, id: row.post_id, user_id: row.user_id,
  content: row.content, media_url: row.media_url, visibility: row.visibility,
  created_at: row.created_at, updated_at: row.updated_at,
  likes_count: Number(row.likes_count ?? 0), comments_count: Number(row.comments_count ?? 0),
  is_liked: Boolean(row.is_liked),
  author: { id: row.user_id, user_id: row.user_id, username: row.author_username,
    full_name: row.author_full_name, headline: row.author_headline, profile_picture: row.author_profile_picture },
});
const tokenId = () => crypto.randomUUID();

module.exports = { isUuid, plain, validEmail, validUrl, pageArgs, badRequest, httpError, safeProfile, formatPost, tokenId };
