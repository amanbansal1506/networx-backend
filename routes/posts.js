const express = require('express');
const pool = require('../db/db');
const auth = require('../middleware/authMiddleware');
const { plain, validUrl, pageArgs, badRequest, httpError, isUuid, formatPost } = require('../utils/helpers');
const router = express.Router();
router.use(auth);

const postSelect = `SELECT p.post_id, p.user_id, p.content, p.media_url, p.visibility, p.created_at, p.updated_at,
   u.username AS author_username, u.full_name AS author_full_name, u.headline AS author_headline,
   u.profile_picture AS author_profile_picture,
   (SELECT count(*)::int FROM post_likes pl WHERE pl.post_id=p.post_id) AS likes_count,
   (SELECT count(*)::int FROM comments cm WHERE cm.post_id=p.post_id) AS comments_count,
   EXISTS (SELECT 1 FROM post_likes pl2 WHERE pl2.post_id=p.post_id AND pl2.user_id=$1) AS is_liked
 FROM posts p JOIN users u ON u.user_id=p.user_id`;
const accessSql = `(p.visibility='public' OR p.user_id=$1 OR EXISTS (
  SELECT 1 FROM networx_connections c WHERE c.status='accepted'
  AND ((c.requester_id=$1 AND c.recipient_id=p.user_id)
    OR (c.recipient_id=$1 AND c.requester_id=p.user_id))))`;

async function getPost(viewerId, postId) {
  if (!isUuid(postId)) httpError(400, 'Invalid post ID');
  const result = await pool.query(`${postSelect} WHERE p.post_id=$2 AND ${accessSql}`, [viewerId, postId]);
  if (!result.rows[0]) httpError(404, 'Post not found');
  return formatPost(result.rows[0]);
}

async function getFeed(viewerId, { authorId = null, limit = 20, offset = 0 } = {}) {
  const result = await pool.query(
    `${postSelect} WHERE ${accessSql} AND ($2::uuid IS NULL OR p.user_id=$2)
     ORDER BY p.created_at DESC, p.post_id DESC LIMIT $3 OFFSET $4`,
    [viewerId, authorId, limit, offset]
  );
  return result.rows.map(formatPost);
}

async function notify(userId, actorId, type, entityId, message) {
  if (userId === actorId) return;
  await pool.query(
    'INSERT INTO notifications (user_id, actor_id, type, entity_id, message) VALUES ($1,$2,$3,$4,$5)',
    [userId, actorId, type, entityId, message]
  );
}

async function listFeed(req, res) {
  const { limit, offset, page } = pageArgs(req.query);
  const posts = await getFeed(req.userId, { limit, offset });
  res.json({ success: true, posts, page, limit });
}

router.get('/', listFeed);
router.get('/me', async (req, res) => {
  const { limit, offset, page } = pageArgs(req.query);
  res.json({ success: true, posts: await getFeed(req.userId, { authorId: req.userId, limit, offset }), page, limit });
});

router.post('/', async (req, res) => {
  const { content = '', media_url = null, visibility = 'public' } = req.body || {};
  if (typeof content !== 'string' || content.length > 5000) badRequest('Post content must be at most 5000 characters');
  if (media_url != null && (typeof media_url !== 'string' || media_url.length > 2000 || !validUrl(media_url))) badRequest('media_url must be an http(s) URL');
  if (!plain(content) && !plain(media_url)) badRequest('Write some content or provide a media URL');
  if (!['public', 'connections'].includes(visibility)) badRequest('visibility must be public or connections');
  const result = await pool.query(
    'INSERT INTO posts (user_id, content, media_url, visibility) VALUES ($1,$2,$3,$4) RETURNING post_id',
    [req.userId, plain(content), plain(media_url) || null, visibility]
  );
  const post = await getPost(req.userId, result.rows[0].post_id);
  res.status(201).json({ success: true, post });
});

router.get('/:id', async (req, res) => res.json({ success: true, post: await getPost(req.userId, req.params.id) }));

router.patch('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) badRequest('Invalid post ID');
  const changes = req.body || {};
  const fields = Object.keys(changes);
  if (!fields.length || fields.some(field => !['content', 'media_url', 'visibility'].includes(field))) badRequest('Only content, media_url and visibility may be changed');
  if ('content' in changes && (typeof changes.content !== 'string' || changes.content.length > 5000)) badRequest('Invalid post content');
  if ('media_url' in changes && changes.media_url !== null && (typeof changes.media_url !== 'string' || changes.media_url.length > 2000 || !validUrl(changes.media_url))) badRequest('Invalid media URL');
  if ('visibility' in changes && !['public', 'connections'].includes(changes.visibility)) badRequest('Invalid visibility');
  const assignments = fields.map((field, index) => `${field}=$${index + 1}`);
  const values = fields.map(field => typeof changes[field] === 'string' ? plain(changes[field]) : changes[field]);
  const updated = await pool.query(
    `UPDATE posts SET ${assignments.join(', ')}, updated_at=NOW() WHERE post_id=$${fields.length + 1} AND user_id=$${fields.length + 2}
     AND (length(trim(COALESCE(${fields.includes('content') ? ` $${fields.indexOf('content') + 1}::text ` : 'content'}, ''))) > 0
        OR COALESCE(${fields.includes('media_url') ? ` $${fields.indexOf('media_url') + 1}::text ` : 'media_url'}, '') <> '') RETURNING post_id`,
    [...values, req.params.id, req.userId]
  );
  if (!updated.rows.length) {
    const owned = await pool.query('SELECT post_id FROM posts WHERE post_id=$1 AND user_id=$2', [req.params.id, req.userId]);
    if (owned.rows.length) badRequest('Post must have content or media');
    httpError(404, 'Post not found or not yours');
  }
  res.json({ success: true, post: await getPost(req.userId, req.params.id) });
});

router.delete('/:id', async (req, res) => {
  if (!isUuid(req.params.id)) badRequest('Invalid post ID');
  const deleted = await pool.query('DELETE FROM posts WHERE post_id=$1 AND user_id=$2 RETURNING post_id', [req.params.id, req.userId]);
  if (!deleted.rows.length) httpError(404, 'Post not found or not yours');
  res.json({ success: true, message: 'Post deleted' });
});

router.post('/:id/like', async (req, res) => {
  const post = await getPost(req.userId, req.params.id);
  const result = await pool.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING post_id', [post.post_id, req.userId]);
  if (result.rows.length) await notify(post.user_id, req.userId, 'post_like', post.post_id, 'Someone liked your post');
  res.json({ success: true, liked: true });
});

router.delete('/:id/like', async (req, res) => {
  await getPost(req.userId, req.params.id);
  await pool.query('DELETE FROM post_likes WHERE post_id=$1 AND user_id=$2', [req.params.id, req.userId]);
  res.json({ success: true, liked: false });
});

router.get('/:id/comments', async (req, res) => {
  await getPost(req.userId, req.params.id);
  const { limit, offset, page } = pageArgs(req.query);
  const result = await pool.query(
    `SELECT c.comment_id, c.comment_id AS id, c.post_id, c.user_id, c.content, c.created_at, c.updated_at,
        u.username, u.full_name, u.profile_picture
      FROM comments c JOIN users u ON u.user_id=c.user_id WHERE c.post_id=$1
      ORDER BY c.created_at ASC, c.comment_id ASC LIMIT $2 OFFSET $3`,
    [req.params.id, limit, offset]
  );
  res.json({ success: true, comments: result.rows, page, limit });
});

router.post('/:id/comments', async (req, res) => {
  const post = await getPost(req.userId, req.params.id);
  const content = req.body?.content;
  if (typeof content !== 'string' || !plain(content) || content.length > 2000) badRequest('Comment must be 1-2000 characters');
  const result = await pool.query(
    `WITH inserted AS (INSERT INTO comments (post_id, user_id, content) VALUES ($1,$2,$3) RETURNING *)
     SELECT i.*, i.comment_id AS id, u.username, u.full_name, u.profile_picture
     FROM inserted i JOIN users u ON u.user_id=i.user_id`,
    [post.post_id, req.userId, plain(content)]
  );
  await notify(post.user_id, req.userId, 'post_comment', post.post_id, 'Someone commented on your post');
  res.status(201).json({ success: true, comment: result.rows[0] });
});

router.delete('/:id/comments/:commentId', async (req, res) => {
  await getPost(req.userId, req.params.id);
  if (!isUuid(req.params.commentId)) badRequest('Invalid comment ID');
  const deleted = await pool.query(
    `DELETE FROM comments c USING posts p WHERE c.comment_id=$1 AND c.post_id=$2 AND p.post_id=c.post_id
      AND (c.user_id=$3 OR p.user_id=$3) RETURNING c.comment_id`,
    [req.params.commentId, req.params.id, req.userId]
  );
  if (!deleted.rows.length) httpError(404, 'Comment not found or not yours');
  res.json({ success: true, message: 'Comment deleted' });
});

const feedRouter = express.Router();
feedRouter.get('/', auth, listFeed);
module.exports = router;
module.exports.feedRouter = feedRouter;
module.exports.getFeed = getFeed;
module.exports.getPost = getPost;
