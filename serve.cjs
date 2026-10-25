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
  // Cloud hosts inject config as real environment variables and never have a .env.local (it is
  // gitignored, so it is never deployed). process.env is therefore the base layer; a file, where
  // one exists, still wins, leaving desktop token rotation via the userData copy exactly as before.
  const fromEnv = {};
  for (const key of ['PG_PROXY_URL', 'PG_PROXY_DB', 'PG_PROXY_TOKEN']) {
    if (process.env[key]) fromEnv[key] = process.env[key];
  }
  const merged = { ...fromEnv, ...bundled, ...(override || {}) };
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

const BUCKETS = new Set(['cases', 'agentDirectory', 'itemDirectory', 'adminDirectory', 'shipmentBatches', 'docLogs', 'deliveryOrders']);

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

// The desktop app gets its version from Electron itself. A browser or cloud host has no such
// channel, so the dashboard asks the server which build it is serving. Read once — the file cannot
// change under a running process without a redeploy.
let cachedVersion;
function appVersion() {
  if (cachedVersion === undefined) {
    try { cachedVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || null; }
    catch (e) { cachedVersion = null; }
  }
  return cachedVersion;
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

// ---------- Staff sign-in ----------
// The data routes below used to answer anyone who could reach the server. Staff now sign in here:
// the password is checked against the adminDirectory rows on the server, and the browser gets an
// HttpOnly session cookie. Passwords never leave the server; the browser only sees names and the
// operator fields the CRM already needs.
const crypto = require('crypto');
const SESSION_COOKIE = 'crm_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map(); // token -> { account, expires }
const failedLogins = new Map(); // lower-cased name -> { count, since }
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function currentSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (sess.expires < Date.now()) { sessions.delete(token); return null; }
  return sess;
}
function cookieSecureSuffix(req) {
  return req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
}
function setSessionCookie(req, res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${cookieSecureSuffix(req)}`);
}
function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cookieSecureSuffix(req)}`);
}
// Reads the staff list straight from the database, so the browser can't skip the check.
async function loadStaffAccounts() {
  const cfg = currentPgConfig();
  if (!cfg.configured) throw new Error('PG proxy not configured on server');
  const out = await runSql(cfg, 'select data from case_hub_records where bucket = $1', ['adminDirectory']);
  return (out.rows || [])
    .map(row => (typeof row.data === 'string' ? JSON.parse(row.data) : row.data))
    .filter(a => a && a.name);
}
function samePassword(given, stored) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(stored || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function operatorFields(a) {
  return { id: a.id, name: a.name, canManageSettings: !!a.canManageSettings };
}

async function handleStaffNames(req, res) {
  try {
    const accounts = await loadStaffAccounts();
    sendJson(res, 200, { accounts: accounts.map(operatorFields) });
  } catch (e) {
    console.error('staff list failed', e.message);
    sendJson(res, 502, { error: e.message });
  }
}

async function handleLogin(req, res) {
  let payload;
  try { payload = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
  const name = String((payload && payload.name) || '');
  const password = String((payload && payload.password) || '');
  const key = name.toLowerCase();
  const failed = failedLogins.get(key);
  if (failed && Date.now() - failed.since < LOGIN_WINDOW_MS && failed.count >= LOGIN_MAX_FAILURES) {
    return sendJson(res, 429, { error: 'Too many failed attempts. Try again in a few minutes.' });
  }
  try {
    const accounts = await loadStaffAccounts();
    const match = accounts.find(a => a.name === name && samePassword(password, a.password));
    if (!match) {
      const now = Date.now();
      const cur = failedLogins.get(key);
      failedLogins.set(key, cur && now - cur.since < LOGIN_WINDOW_MS ? { count: cur.count + 1, since: cur.since } : { count: 1, since: now });
      return sendJson(res, 401, { error: 'Name or password incorrect.' });
    }
    failedLogins.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    const account = operatorFields(match);
    sessions.set(token, { account, expires: Date.now() + SESSION_TTL_MS });
    setSessionCookie(req, res, token);
    sendJson(res, 200, { account });
  } catch (e) {
    console.error('login failed', e.message);
    sendJson(res, 502, { error: e.message });
  }
}

function handleMe(req, res) {
  const sess = currentSession(req);
  if (!sess) return sendJson(res, 401, { error: 'Not signed in' });
  sendJson(res, 200, { account: sess.account });
}

function handleLogout(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  clearSessionCookie(req, res);
  sendJson(res, 200, { ok: true });
}

// Every /api/pg/* route needs a staff session. Anything else is refused before it reaches SQL.
function requireStaff(req, res, handler) {
  if (!currentSession(req)) return sendJson(res, 401, { error: 'Sign in required' });
  return handler(req, res);
}

function createServer({ entry }) {
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'POST' && url === '/api/auth/staff-names') return handleStaffNames(req, res);
    if (req.method === 'POST' && url === '/api/auth/login') return handleLogin(req, res);
    if (req.method === 'POST' && url === '/api/auth/logout') return handleLogout(req, res);
    if (req.method === 'GET' && url === '/api/auth/me') return handleMe(req, res);
    if (req.method === 'POST' && url === '/api/pg/read') return requireStaff(req, res, handlePgRead);
    if (req.method === 'POST' && url === '/api/pg/write') return requireStaff(req, res, handlePgWrite);
    if (req.method === 'POST' && url === '/api/pg/delete') return requireStaff(req, res, handlePgDelete);
    if (req.method === 'GET' && url === '/api/version') return sendJson(res, 200, { version: appVersion() });
    serveStatic(entry, req, res);
  });
}

function startServer({ entry, port, host = '127.0.0.1' }) {
  return new Promise((resolve, reject) => {
    const server = createServer({ entry });
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

module.exports = { startServer, createServer, setUserDataDir, currentPgConfig };

if (require.main === module) {
  // CLI usage for local dev / the browser preview tool: node serve.cjs <entry> <port>
  const ENTRY = process.argv[2] || process.env.ENTRY || 'index.html.html';
  // A cloud host assigns PORT and routes traffic in from outside, so its PORT wins over the one in
  // the start script and the server listens on every interface. Anywhere else it stays on loopback:
  // this server holds full SQL access to the database and must not be reachable from the LAN.
  const PORT = Number(process.env.PORT || process.argv[3]) || 8935;
  const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
  startServer({ entry: ENTRY, port: PORT, host: HOST }).then(() => {
    const cfg = currentPgConfig();
    console.log(`CRM running at http://${HOST}:${PORT}/ (entry: ${ENTRY}, pg proxy: ${cfg.configured ? 'configured' : 'NOT configured'})`);
  });
}
