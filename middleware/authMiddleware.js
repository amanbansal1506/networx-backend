const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const bearer = req.get('authorization');
  const token = req.cookies?.token || (bearer?.startsWith('Bearer ') ? bearer.slice(7) : null);
  if (!token) return res.status(401).json({ success: false, message: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!payload.id) throw new Error('Missing user id');
    req.userId = payload.id;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}
module.exports = authMiddleware;
