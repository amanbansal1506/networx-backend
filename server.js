require('dotenv').config();

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('Set DATABASE_URL and a JWT_SECRET of at least 32 characters in .env.');
  process.exit(1);
}

const app = require('./app');
const pool = require('./db/db');
const port = Number(process.env.PORT || 8000);

const server = app.listen(port, () => console.log(`NetworX backend running at http://localhost:${port}`));
function shutdown() {
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
