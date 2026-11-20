const express = require('express');
const pool = require('../db/db');
const auth = require('../middleware/authMiddleware');
const { plain, validUrl, pageArgs, badRequest, httpError, safeProfile, isUuid } = require('../utils/helpers');
const router = express.Router();
router.use(auth);

const publicFields = `u.user_id, u.username, u.full_name, u.type, u.headline, u.profile_picture,
    u.cover_pic, u.about, u.website, u.industry, u.companysize, u.hq, u.location,
    u.skills, u.isverified, u.isbrand, u.created_at`;

router.get('/me', async (req, res) => {
  const result = await pool.query(`SELECT ${publicFields}, u.email, u.updated_at FROM users u WHERE u.user_id=$1`, [req.userId]);
  if (!result.rows.length) httpError(404, 'User not found');
  res.json({ success: true, user: safeProfile(result.rows[0]) });
});

router.patch('/me', async (req, res) => {
  const permitted = ['full_name', 'headline', 'profile_picture', 'cover_pic', 'about', 'website', 'industry', 'companysize', 'hq', 'location', 'skills'];
  const { ...body } = req.body || {};
  if (!body || Object.keys(body).length === 0) badRequest('Provide profile fields to update');
  const keys = Object.keys(body);
  if (keys.some(key => !permitted.includes(key))) badRequest('One or more profile fields cannot be updated');
  for (const key of keys) {
    const value = body[key];
    if (['full_name', 'headline', 'about'].includes(key) && value === null) badRequest(`${key} cannot be null`);
    if (key === 'skills') {
      if (!Array.isArray(value) || value.length > 30 || value.some(skill => typeof skill !== 'string' || !plain(skill) || skill.length > 60)) badRequest('skills must contain up to 30 nonempty strings (max 60 characters each)');
    } else if (value != null && typeof value !== 'string') badRequest(`${key} must be a string or null`);
    if (['website', 'profile_picture', 'cover_pic'].includes(key) && !validUrl(value)) badRequest(`${key} must be an http(s) URL`);
    const max = { full_name: 120, headline: 200, industry: 120, companysize: 60, hq: 160, location: 160, about: 5000, website: 1000, profile_picture: 2000, cover_pic: 2000 }[key];
    if (typeof value === 'string' && value.length > max) badRequest(`${key} exceeds ${max} characters`);
    if (key === 'full_name' && !plain(value)) badRequest('Full name cannot be empty');
  }
  const assignments = keys.map((key, index) => `${key}=$${index + 1}`);
  const values = keys.map(key => key === 'skills' ? body[key].map(plain) : (typeof body[key] === 'string' ? plain(body[key]) : body[key]));
  const updated = await pool.query(
    `UPDATE users SET ${assignments.join(', ')}, updated_at=NOW() WHERE user_id=$${values.length + 1} RETURNING *`,
    [...values, req.userId]
  );
  if (!updated.rows.length) httpError(404, 'User not found');
  res.json({ success: true, user: safeProfile(updated.rows[0]) });
});

router.get('/search', async (req, res) => {
  const { limit, offset, page } = pageArgs(req.query);
  const q = plain(req.query.q || '');
  if (q.length < 2 || q.length > 100) badRequest('Search query q must be 2-100 characters');
  const escaped = q.replace(/[\\%_]/g, '\\$&');
  const result = await pool.query(
    `SELECT ${publicFields} FROM users u
     WHERE u.user_id <> $1 AND (u.username ILIKE $2 ESCAPE '\\' OR u.full_name ILIKE $2 ESCAPE '\\' OR COALESCE(u.headline,'') ILIKE $2 ESCAPE '\\')
     ORDER BY u.full_name ASC, u.user_id ASC LIMIT $3 OFFSET $4`,
    [req.userId, `%${escaped}%`, limit, offset]
  );
  res.json({ success: true, users: result.rows.map(safeProfile), page, limit });
});

router.get('/suggestions', async (req, res) => {
  const { limit } = pageArgs(req.query);
  const result = await pool.query(
    `SELECT ${publicFields} FROM users u
     WHERE u.user_id <> $1 AND NOT EXISTS (
       SELECT 1 FROM networx_connections c WHERE (c.requester_id=$1 AND c.recipient_id=u.user_id)
         OR (c.recipient_id=$1 AND c.requester_id=u.user_id)
     ) ORDER BY u.created_at DESC LIMIT $2`,
    [req.userId, limit]
  );
  res.json({ success: true, users: result.rows.map(safeProfile) });
});

async function findUser(identifier) {
  const result = await pool.query(
    `SELECT ${publicFields} FROM users u WHERE ${isUuid(identifier) ? 'u.user_id=$1' : 'LOWER(u.username)=LOWER($1)'} LIMIT 1`,
    [identifier]
  );
  return result.rows[0];
}

router.get('/:identifier/posts', async (req, res) => {
  const user = await findUser(req.params.identifier);
  if (!user) httpError(404, 'User not found');
  const { getFeed } = require('./posts');
  const { limit, offset, page } = pageArgs(req.query);
  const posts = await getFeed(req.userId, { authorId: user.user_id, limit, offset });
  res.json({ success: true, posts, page, limit, user_id: user.user_id });
});

router.get('/:identifier', async (req, res) => {
  const user = await findUser(req.params.identifier);
  if (!user) httpError(404, 'User not found');
  const [connection, counts] = await Promise.all([
    pool.query(`SELECT connection_id, requester_id, recipient_id, status FROM networx_connections
      WHERE (requester_id=$1 AND recipient_id=$2) OR (requester_id=$2 AND recipient_id=$1) LIMIT 1`, [req.userId, user.user_id]),
    pool.query(`SELECT COUNT(*)::int AS count FROM networx_connections WHERE status='accepted' AND (requester_id=$1 OR recipient_id=$1)`, [user.user_id]),
  ]);
  res.json({ success: true, user: safeProfile(user), connection: connection.rows[0] || null, connections_count: counts.rows[0].count });
});
module.exports = router;
