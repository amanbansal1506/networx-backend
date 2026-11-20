const express = require('express');
const pool = require('../db/db');
const auth = require('../middleware/authMiddleware');
const { isUuid, plain, pageArgs, badRequest, httpError, safeProfile } = require('../utils/helpers');
const router = express.Router();
router.use(auth);

async function resolveRecipient(identifier) {
  if (typeof identifier !== 'string' || !identifier || identifier.length > 254) badRequest('Provide a recipient user ID or username');
  const result = await pool.query(
    `SELECT user_id, username FROM users WHERE ${isUuid(identifier) ? 'user_id = $1' : 'LOWER(username) = LOWER($1)'} LIMIT 1`,
    [identifier]
  );
  if (!result.rows[0]) httpError(404, 'User not found');
  return result.rows[0];
}

async function createRequest(req, res, identifier) {
  const recipient = await resolveRecipient(identifier);
  if (recipient.user_id === req.userId) badRequest('Cannot connect with yourself');
  const result = await pool.query(
    `INSERT INTO networx_connections (requester_id, recipient_id) VALUES ($1,$2)
     ON CONFLICT DO NOTHING RETURNING *`,
    [req.userId, recipient.user_id]
  );
  if (!result.rows.length) {
    const existing = await pool.query(
      `SELECT connection_id, requester_id, recipient_id, status FROM networx_connections
       WHERE (requester_id=$1 AND recipient_id=$2) OR (requester_id=$2 AND recipient_id=$1)`,
      [req.userId, recipient.user_id]
    );
    const row = existing.rows[0];
    if (!row) return res.status(409).json({ success: false, message: 'Request already being processed. Please retry.' });
    if (row.status === 'rejected') {
      const renewed = await pool.query(
        `UPDATE networx_connections SET requester_id=$1, recipient_id=$2, status='pending', updated_at=NOW()
         WHERE connection_id=$3 AND status='rejected' RETURNING *`,
        [req.userId, recipient.user_id, row.connection_id]
      );
      if (renewed.rows.length) {
        await pool.query(`INSERT INTO notifications (user_id, actor_id, type, entity_id, message)
          VALUES ($1,$2,'connection_request',$3,$4)`, [recipient.user_id, req.userId, renewed.rows[0].connection_id, 'You received a connection request']);
        return res.status(201).json({ success: true, connection: renewed.rows[0] });
      }
    }
    return res.status(409).json({ success: false, message: row.status === 'accepted' ? 'Already connected' : 'A connection request is already pending', connection: row });
  }
  const connection = result.rows[0];
  await pool.query(`INSERT INTO notifications (user_id, actor_id, type, entity_id, message)
     VALUES ($1,$2,'connection_request',$3,$4)`, [recipient.user_id, req.userId, connection.connection_id, 'You received a connection request']);
  res.status(201).json({ success: true, connection });
}

// POST /api/connections/request { recipient_id: 'uuid' } OR { username: '...' }
router.post('/request', async (req, res) => {
  const { recipient_id, target_user_id, user_id, username } = req.body || {};
  await createRequest(req, res, recipient_id || target_user_id || user_id || username);
});
// Alternate REST-style request endpoint.
router.post('/:identifier/request', async (req, res) => createRequest(req, res, req.params.identifier));

router.get('/', async (req, res) => {
  const { limit, offset, page } = pageArgs(req.query);
  const result = await pool.query(
    `SELECT c.connection_id, c.created_at, c.status, u.user_id, u.username, u.full_name,
      u.headline, u.profile_picture, u.type
     FROM networx_connections c JOIN users u ON u.user_id = CASE WHEN c.requester_id=$1 THEN c.recipient_id ELSE c.requester_id END
     WHERE c.status='accepted' AND (c.requester_id=$1 OR c.recipient_id=$1)
     ORDER BY u.full_name ASC, c.created_at DESC LIMIT $2 OFFSET $3`, [req.userId, limit, offset]
  );
  res.json({ success: true, connections: result.rows.map(row => ({
    connection_id: row.connection_id, status: row.status, created_at: row.created_at,
    user: safeProfile({ user_id: row.user_id, username: row.username, full_name: row.full_name, headline: row.headline, profile_picture: row.profile_picture, type: row.type })
  })), page, limit });
});

router.get('/pending', async (req, res) => {
  const { limit, offset, page } = pageArgs(req.query);
  const direction = req.query.direction || 'incoming';
  if (!['incoming', 'outgoing'].includes(direction)) badRequest('direction must be incoming or outgoing');
  const incoming = direction === 'incoming';
  const result = await pool.query(
    `SELECT c.connection_id, c.created_at, c.status, u.user_id, u.username, u.full_name, u.headline, u.profile_picture
     FROM networx_connections c JOIN users u ON u.user_id=c.${incoming ? 'requester_id' : 'recipient_id'}
     WHERE c.status='pending' AND c.${incoming ? 'recipient_id' : 'requester_id'}=$1
     ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`, [req.userId, limit, offset]
  );
  res.json({ success: true, requests: result.rows.map(row => ({ connection_id: row.connection_id, status: row.status, created_at: row.created_at, user: safeProfile({ user_id: row.user_id, username: row.username, full_name: row.full_name, headline: row.headline, profile_picture: row.profile_picture }) })), direction, page, limit });
});

router.patch('/:id/accept', async (req, res) => {
  if (!isUuid(req.params.id)) badRequest('Invalid connection ID');
  const result = await pool.query(
    `UPDATE networx_connections SET status='accepted', updated_at=NOW()
     WHERE connection_id=$1 AND recipient_id=$2 AND status='pending' RETURNING *`, [req.params.id, req.userId]
  );
  if (!result.rows.length) httpError(404, 'Pending incoming request not found');
  const connection = result.rows[0];
  await pool.query(`INSERT INTO notifications (user_id, actor_id, type, entity_id, message)
    VALUES ($1,$2,'connection_accepted',$3,$4)`, [connection.requester_id, req.userId, connection.connection_id, 'Your connection request was accepted']);
  res.json({ success: true, connection });
});

router.patch('/:id/reject', async (req, res) => {
  if (!isUuid(req.params.id)) badRequest('Invalid connection ID');
  const result = await pool.query(
    `UPDATE networx_connections SET status='rejected', updated_at=NOW()
     WHERE connection_id=$1 AND recipient_id=$2 AND status='pending' RETURNING connection_id`, [req.params.id, req.userId]
  );
  if (!result.rows.length) httpError(404, 'Pending incoming request not found');
  res.json({ success: true, message: 'Request rejected' });
});

router.delete('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) badRequest('Invalid connection ID');
  const result = await pool.query(
    `DELETE FROM networx_connections WHERE connection_id=$1 AND (requester_id=$2 OR recipient_id=$2) RETURNING connection_id`,
    [req.params.id, req.userId]
  );
  if (!result.rows.length) httpError(404, 'Connection not found');
  res.json({ success: true, message: 'Connection removed or request cancelled' });
});

module.exports = router;
