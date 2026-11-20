/* Syntax-check each JavaScript file and smoke-check the HTTP application.
   Run after npm install: npm run check */
require('dotenv').config();
const { readdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules') return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? jsFiles(file) : entry.name.endsWith('.js') ? [file] : [];
  });
}
for (const file of jsFiles(root)) {
  const run = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`Syntax error in ${path.relative(root, file)}:\n${run.stderr}`);
}
console.log('PASS: JavaScript syntax');

(async () => {
  const app = require('../app');
  const server = app.listen(0);
  try {
    await new Promise((resolve, reject) => { if (server.listening) resolve(); else { server.once('listening', resolve); server.once('error', reject); } });
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    const blocked = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { origin: 'https://example-attacker.test' } });
    assert.equal(blocked.status, 403);
    console.log('PASS: /health and cross-origin write protection');
  } finally {
    await new Promise(resolve => server.close(resolve));
    const pool = require('../db/db');
    await pool.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
