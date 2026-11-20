const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db/db');
const requireAuth = require('../middleware/authMiddleware');
const { plain, validEmail, safeProfile, badRequest } = require('../utils/helpers');
const router = express.Router();

function cookieOptions() {
  const sameSite = process.env.COOKIE_SAMESITE || 'lax';
  if (!['lax', 'none', 'strict'].includes(sameSite)) throw new Error('COOKIE_SAMESITE must be lax, strict or none');
  const secure = process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
  if (sameSite === 'none' && !secure) throw new Error('Cross-site cookies require COOKIE_SECURE=true and HTTPS');
  return { httpOnly: true, sameSite, secure, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 };
}

router.post('/signup', async (req, res) => {
  const { username, full_name, email, password, type = 'person' } = req.body || {};
  const name = plain(username);
  const fullName = plain(full_name);
  const mail = plain(email).toLowerCase();
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(name)) badRequest('Username must be 3-40 characters (letters, numbers, _, -, .)');
  if (!fullName || fullName.length > 120) badRequest('Name must be 1-120 characters');
  if (mail.length > 254 || !validEmail(mail)) badRequest('Invalid email format');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) badRequest('Password must be 8-128 characters');
  if (!['person', 'company'].includes(type)) badRequest('Invalid account type');
  const hash = await bcrypt.hash(password, 12);
  try {
    await pool.query(
      'INSERT INTO users (username, full_name, email, password, type) VALUES ($1,$2,$3,$4,$5)',
      [name, fullName, mail, hash, type]
    );
    res.status(201).json({ success: true, message: 'Account created successfully' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Username or email is already registered' });
    throw err;
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const login = plain(username);
  if (!login || typeof password !== 'string') badRequest('Username and password are required');
  const result = await pool.query(
    'SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1',
    [login]
  );
  const row = result.rows[0];
  const valid = row?.password ? await bcrypt.compare(password, row.password) : false;
  if (!valid) return res.status(401).json({ success: false, message: 'Invalid username or password' });
  const token = jwt.sign({ id: row.user_id }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
  res.cookie('token', token, cookieOptions());
  return res.json({ success: true, message: 'Login successful', user: safeProfile(row) });
});

router.get('/check_auth', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT user_id, user_id AS id, username, full_name, email, headline, profile_picture, type FROM users WHERE user_id=$1',
    [req.userId]
  );
  if (!result.rows.length) return res.status(401).json({ isAuthenticated: false, user: null });
  return res.json({ isAuthenticated: true, user: result.rows[0] });
});

router.get('/user_details', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT user_id, user_id AS id, username, full_name, email, type, headline, profile_picture,
            cover_pic, about, website, industry, companysize, hq, location, skills,
            isverified, isbrand, created_at, updated_at
     FROM users WHERE user_id=$1`,
    [req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ success: false, message: 'User not found' });
  return res.json({ success: true, userData: result.rows[0], meta: { user_id: req.userId } });
});

router.post('/logout', (_req, res) => {
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie('token', options);
  res.json({ success: true, message: 'Logged out' });
});

router.patch('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (typeof current_password !== 'string' || typeof new_password !== 'string' || new_password.length < 8 || new_password.length > 128) {
    badRequest('Current password and a new 8-128-character password are required');
  }
  const result = await pool.query('SELECT password FROM users WHERE user_id=$1', [req.userId]);
  if (!result.rows[0] || !await bcrypt.compare(current_password, result.rows[0].password)) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect' });
  }
  const hashedPassword = await bcrypt.hash(new_password, 12);
  await pool.query('UPDATE users SET password=$1, updated_at=NOW() WHERE user_id=$2', [hashedPassword, req.userId]);
  return res.json({ success: true, message: 'Password updated' });
});

module.exports = router;
