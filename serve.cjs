// Static server for the single-file CRM app, plus the server-side proxy to Postgres.
//
// Postgres (NUrul_DB) is the app's only store — the browser reads and writes through the
// /api/pg/* routes below. It used to read from Firestore and mirror here; that was removed so the
// data lives solely in the company's own database.
//
// The Postgres proxy token grants full SQL access to the production database (NUrul_DB — the
// same DB the main CRM runs on, ~90 tables). It must never reach the browser: this process holds
// it in memory and is the only thing that ever calls pg-proxy. The HTML files call THIS server's
// /api/pg/* routes instead.
//
// Also used as a module (not just a CLI script): electron/main.cjs requires this file and calls
// startServer() directly, so the desktop app runs the exact same server code as local dev.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function parseEnvContent(content) {
  const out = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return null;
  return parseEnvContent(fs.readFileSync(file, 'utf8'));
}

// Set by electron/main.cjs on startup, pointing at Electron's per-user data folder. Config there
// (a copy of .env.local, seeded on first run) always wins over the copy bundled with the app, so
// rotating the Postgres token means editing one text file — never rebuilding or reinstalling.
// Read fresh on every request (not cached) so a saved edit applies immediately, no restart needed.
// Stays null outside Electron (plain `node serve.cjs` for local dev), which then just reads the
// bundled .env.local exactly as before.
let userDataDir = null;
function setUserDataDir(dir) { userDataDir = dir; }

function currentPgConfig() {
  const bundled = loadEnvFile(path.join(ROOT, '.env.local')) || {};
  const override = userDataDir ? loadEnvFile(path.join(userDataDir, '.env.local')) : null;
  const merged = { ...bundled, ...(override || {}) };
  return {
    url: merged.PG_PROXY_URL,
    db: merged.PG_PROXY_DB,
    token: merged.PG_PROXY_TOKEN,
    configured: !!(merged.PG_PROXY_URL && merged.PG_PROXY_DB && merged.PG_PROXY_TOKEN),
  };
}

// Runs one parameterized statement through pg-proxy. Every caller in this file supplies both
// bucket and id as bind params ($1/$2/...) — never string-concatenated — so request bodies can
// never be used to inject SQL.
const RETRY_DELAYS_MS = [300, 900, 2000];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runSqlOnce(cfg, sql, params) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.token}` },
    body: JSON.stringify({ db_name: cfg.db, sql, params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || `pg-proxy HTTP ${res.status}`);
  return body;
}

// A failure here is only reported after every retry is spent, so callers can treat a thrown
// error as genuinely down rather than as a blip.
async function runSql(cfg, sql, params) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try { return await runSqlOnce(cfg, sql, params); }
    catch (e) {
      lastErr = e;
      if (attempt === RETRY_DELAYS_MS.length) break;
      console.warn(`pg-proxy attempt ${attempt + 1} failed (${e.message}) — retrying`);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr;
}

const BUCKETS = new Set(['cases', 'agentDirectory', 'itemDirectory', 'adminDirectory', 'shipmentBatches', 'docLogs']);

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5_000_000) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

async function handlePgRead(req, res) {
  const cfg = currentPgConfig();
  if (!cfg.configured) return sendJson(res, 503, { error: 'PG proxy not configured on server' });
  let payload = {};
  try { payload = await readJsonBody(req); } catch (e) { /* no body means "every bucket" */ }
  const wanted = payload && payload.bucket ? [payload.bucket] : [...BUCKETS];
  if (wanted.some(b => !BUCKETS.has(b))) return sendJson(res, 400, { error: 'Unknown bucket' });
  try {
    const out = await runSql(cfg,
      `select bucket, data from case_hub_records where bucket = any($1::text[]) order by updated_at`,
      [wanted]
    );
    const grouped = {};
    wanted.forEach(b => { grouped[b] = []; });
    (out.rows || []).forEach(row => {
      // pg returns jsonb as an object already; tolerate a string in case the driver differs.
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      if (grouped[row.bucket]) grouped[row.bucket].push(data);
    });
    sendJson(res, 200, { buckets: grouped });
  } catch (e) {
    console.error('pg read failed', e.message);
    sendJson(res, 502, { error: e.message });
  }
}

async function handlePgWrite(req, res) {
  const cfg = currentPgConfig();
  if (!cfg.configured) return sendJson(res, 503, { error: 'PG proxy not configured on server' });
  let payload;
  try { payload = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
  const { bucket, record } = payload || {};
  if (!BUCKETS.has(bucket)) return sendJson(res, 400, { error: `Unknown bucket "${bucket}"` });
  if (!record || typeof record.id !== 'string' || !record.id) return sendJson(res, 400, { error: 'record.id is required' });
  try {
    await runSql(cfg,
      `insert into case_hub_records (bucket, id, data, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (bucket, id) do update set data = excluded.data, updated_at = now()`,
      [bucket, record.id, JSON.stringify(record)]
    );
    sendJson(res, 200, { ok: true });
  } catch (e) {
    console.error('pg write failed', bucket, record.id, e.message);
    sendJson(res, 502, { error: e.message });
  }
}

async function handlePgDelete(req, res) {
  const cfg = currentPgConfig();
  if (!cfg.configured) return sendJson(res, 503, { error: 'PG proxy not configured on server' });
  let payload;
  try { payload = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
  const { bucket, id } = payload || {};
  if (!BUCKETS.has(bucket)) return sendJson(res, 400, { error: `Unknown bucket "${bucket}"` });
  if (typeof id !== 'string' || !id) return sendJson(res, 400, { error: 'id is required' });
  try {
    await runSql(cfg, `delete from case_hub_records where bucket = $1 and id = $2`, [bucket, id]);
    sendJson(res, 200, { ok: true });
  } catch (e) {
    console.error('pg delete failed', bucket, id, e.message);
    sendJson(res, 502, { error: e.message });
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function serveStatic(entry, req, res) {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const rel = url === '/' ? entry : url.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);

  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function createServer({ entry }) {
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'POST' && url === '/api/pg/read') return handlePgRead(req, res);
    if (req.method === 'POST' && url === '/api/pg/write') return handlePgWrite(req, res);
    if (req.method === 'POST' && url === '/api/pg/delete') return handlePgDelete(req, res);
    serveStatic(entry, req, res);
  });
}

function startServer({ entry, port }) {
  return new Promise((resolve, reject) => {
    const server = createServer({ entry });
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

module.exports = { startServer, createServer, setUserDataDir, currentPgConfig };

if (require.main === module) {
  // CLI usage for local dev / the browser preview tool: node serve.cjs <entry> <port>
  const ENTRY = process.argv[2] || process.env.ENTRY || 'index.html.html';
  const PORT = Number(process.argv[3] || process.env.PORT) || 8934;
  startServer({ entry: ENTRY, port: PORT }).then(() => {
    const cfg = currentPgConfig();
    console.log(`CRM running at http://localhost:${PORT}/ (entry: ${ENTRY}, pg proxy: ${cfg.configured ? 'configured' : 'NOT configured'})`);
  });
}
