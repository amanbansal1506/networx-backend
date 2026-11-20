const express = require('express');
const pool = require('../db/db');
const auth = require('../middleware/authMiddleware');
const { isUuid, pageArgs, badRequest, httpError } = require('../utils/helpers');
const router = express.Router();
router.use(auth);

router.get('/', async (req, res) => {
  const { limit, offset, page } = pageArgs(req.query);
  const onlyUnread = req.query.unread === 'true';
  if (req.query.unread && !['true', 'false'].includes(req.query.unread)) badRequest('unread must be true or false');
  const results = await Promise.all([
    pool.query(`SELECT n.*, a.username AS actor_username, a.full_name AS actor_full_name, a.profile_picture AS actor_profile_picture
       FROM notifications n LEFT JOIN users a ON a.user_id=n.actor_id
       WHERE n.user_id=$1 AND ($2::boolean = FALSE OR n.is_read=FALSE)
       ORDER BY n.created_at DESC, n.notification_id DESC LIMIT $3 OFFSET $4`, [req.userId, onlyUnread, limit, offset]),
    pool.query(`SELECT COUNT(*)::int AS unread_count FROM notifications WHERE user_id=$1 AND is_read=FALSE`, [req.userId])
  ]);
  res.json({ success: true, notifications: results[0].rows, unread_count: results[1].rows[0].unread_count, page, limit });
});

router.patch('/read-all', async (req, res) => {
  const result = await pool.query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE', [req.userId]);
  res.json({ success: true, updated: result.rowCount });
});

router.patch('/:id/read', async (req, res) => {
  if (!isUuid(req.params.id)) badRequest('Invalid notification ID');
  const result = await pool.query('UPDATE notifications SET is_read=TRUE WHERE notification_id=$1 AND user_id=$2 RETURNING *', [req.params.id, req.userId]);
  if (!result.rows.length) httpError(404, 'Notification not found');
  res.json({ success: true, notification: result.rows[0] });
});

router.delete('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) badRequest('Invalid notification ID');
  const result = await pool.query('DELETE FROM notifications WHERE notification_id=$1 AND user_id=$2 RETURNING notification_id', [req.params.id, req.userId]);
  if (!result.rows.length) httpError(404, 'Notification not found');
  res.json({ success: true, message: 'Notification deleted' });
});

module.exports = router;
