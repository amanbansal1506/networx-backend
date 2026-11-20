const express = require('express');
const pool = require('../db/db');
const auth = require('../middleware/authMiddleware');
const { plain, isUuid, pageArgs, badRequest, httpError } = require('../utils/helpers');
const router = express.Router();
router.use(auth);

const definitions = {
  experience: {
    table: 'experiences', id: 'experience_id',
    fields: { title: 160, company: 160, location: 160, start_date: 'date', end_date: 'date', is_current: 'boolean', description: 5000 },
    required: ['title', 'company']
  },
  education: {
    table: 'educations', id: 'education_id',
    fields: { school: 200, degree: 160, field_of_study: 160, start_date: 'date', end_date: 'date', description: 5000 },
    required: ['school']
  }
};

function validateBody(source, definition, { creating = false } = {}) {
  const body = source || {};
  if (Array.isArray(body) || typeof body !== 'object') badRequest('JSON object required');
  const keys = Object.keys(body);
  if (!keys.length) badRequest('Supply at least one field');
  if (keys.some(key => !(key in definition.fields))) badRequest('Unrecognized profile field');
  for (const required of definition.required) {
    if ((creating || required in body) && !plain(body[required])) badRequest(`${required} is required`);
  }
  const values = {};
  for (const key of keys) {
    const val = body[key];
    const rule = definition.fields[key];
    if (rule === 'boolean') {
      if (typeof val !== 'boolean') badRequest(`${key} must be a boolean`);
      values[key] = val;
    } else if (rule === 'date') {
      if (val === null || val === '') values[key] = null;
      else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val) && !Number.isNaN(Date.parse(`${val}T00:00:00Z`)) && new Date(`${val}T00:00:00Z`).toISOString().slice(0, 10) === val) values[key] = val;
      else badRequest(`${key} must be YYYY-MM-DD or null`);
    } else {
      if (typeof val !== 'string' && val !== null) badRequest(`${key} must be a string or null`);
      if (typeof val === 'string' && val.length > rule) badRequest(`${key} is too long (max ${rule})`);
      values[key] = val === null ? null : plain(val);
    }
  }
  if ('start_date' in values && 'end_date' in values && values.start_date && values.end_date && values.end_date < values.start_date) badRequest('End date must not precede start date');
  if (values.is_current === true && values.end_date) badRequest('A current role cannot have an end date');
  return values;
}

for (const [section, definition] of Object.entries(definitions)) {
  router.get(`/${section}`, async (req, res) => {
    const { page, limit, offset } = pageArgs(req.query);
    const userId = req.query.user_id || req.userId;
    if (!isUuid(userId)) badRequest('Invalid user ID');
    const result = await pool.query(`SELECT * FROM ${definition.table} WHERE user_id=$1 ORDER BY start_date DESC NULLS LAST, created_at DESC LIMIT $2 OFFSET $3`, [userId, limit, offset]);
    res.json({ success: true, [section]: result.rows.map(row => ({ ...row, id: row[definition.id] })), page, limit });
  });
  router.post(`/${section}`, async (req, res) => {
    const input = validateBody(req.body, definition, { creating: true });
    const keys = Object.keys(input);
    const columns = ['user_id', ...keys];
    const placeholders = columns.map((_, i) => `$${i + 1}`);
    const result = await pool.query(`INSERT INTO ${definition.table} (${columns.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`, [req.userId, ...keys.map(key => input[key])]);
    res.status(201).json({ success: true, item: { ...result.rows[0], id: result.rows[0][definition.id] } });
  });
  router.patch(`/${section}/:id`, async (req, res) => {
    if (!isUuid(req.params.id)) badRequest('Invalid record ID');
    const input = validateBody(req.body, definition);
    const keys = Object.keys(input);
    const clauses = keys.map((key, i) => `${key}=$${i + 1}`);
    const result = await pool.query(
      `UPDATE ${definition.table} SET ${clauses.join(', ')} WHERE ${definition.id}=$${keys.length + 1} AND user_id=$${keys.length + 2} RETURNING *`,
      [...keys.map(key => input[key]), req.params.id, req.userId]
    );
    if (!result.rows.length) httpError(404, 'Record not found or not yours');
    res.json({ success: true, item: { ...result.rows[0], id: result.rows[0][definition.id] } });
  });
  router.delete(`/${section}/:id`, async (req, res) => {
    if (!isUuid(req.params.id)) badRequest('Invalid record ID');
    const result = await pool.query(`DELETE FROM ${definition.table} WHERE ${definition.id}=$1 AND user_id=$2 RETURNING ${definition.id}`, [req.params.id, req.userId]);
    if (!result.rows.length) httpError(404, 'Record not found or not yours');
    res.json({ success: true, message: 'Record deleted' });
  });
}

module.exports = router;
