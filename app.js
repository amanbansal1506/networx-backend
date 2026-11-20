const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const postRoutes = require('./routes/posts');
const connectionRoutes = require('./routes/connections');
const notificationRoutes = require('./routes/notifications');
const profileRoutes = require('./routes/profileSections');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const origins = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map(x => x.trim()).filter(Boolean);
// CORS controls browser reads; this additional check rejects cross-origin writes
// using cookie authentication. API clients without an Origin header still work.
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && !origins.includes(origin) && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return res.status(403).json({ success: false, message: 'Origin not allowed' });
  }
  next();
});
app.use(cors({ origin: (origin, callback) => callback(null, !origin || origins.includes(origin)), credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.get('/health', (_req, res) => res.json({ ok: true, service: 'networx-backend' }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/feed', postRoutes.feedRouter);
app.use('/api/connections', connectionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/profile', profileRoutes);
app.use(notFound);
app.use(errorHandler);
module.exports = app;
