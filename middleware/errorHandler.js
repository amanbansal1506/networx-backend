function notFound(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
}
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const schemaProblem = ['42P01', '42703'].includes(err.code);
  const databaseUnavailable = ['ECONNREFUSED', 'ENOTFOUND', '28P01', '3D000'].includes(err.code);
  const status = err.status || ({ '23505': 409, '23503': 409, '23514': 400, '23502': 400, '22P02': 400 }[err.code] || (err.type === 'entity.too.large' ? 413 : 500));
  if (status >= 500) {
    console.error('API error:', { method: req.method, path: req.path, code: err.code, message: err.message });
    if (schemaProblem) console.error('Missing DB table/column. Run npm run repair in the backend directory.');
    if (databaseUnavailable) console.error('Database unavailable. Verify PostgreSQL and DATABASE_URL in backend .env.');
  }
  let message = status >= 500 ? 'Internal server error' : err.message;
  if (process.env.NODE_ENV !== 'production' && schemaProblem) message = 'Database tables or columns are missing. Run npm run repair in the backend folder, then restart the backend.';
  if (process.env.NODE_ENV !== 'production' && databaseUnavailable) message = 'Database connection failed. Check PostgreSQL and backend DATABASE_URL.';
  res.status(status).json({ success: false, message });
}
module.exports = { notFound, errorHandler };
