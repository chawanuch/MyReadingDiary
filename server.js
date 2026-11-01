'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const mysql = require('mysql2/promise');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error('Cannot load application environment');
}

const port = Number(process.env.PORT);
const host = process.env.HOST || '0.0.0.0';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Set PORT to a valid port in the application environment');
}

let shareUrl = null;
if (process.env.SHARE_URL) {
  const configured = new URL(process.env.SHARE_URL);
  if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password ||
      configured.search || configured.hash || configured.pathname !== '/' || configured.href.length > 512) {
    throw new Error('SHARE_URL must be an HTTP(S) site URL without credentials, query or fragment');
  }
  shareUrl = configured.href;
}
// Generate once from trusted configuration, never from a request or Host header.
const shareQr = shareUrl ? QRCode.toBuffer(shareUrl, {
  type: 'png', width: 320, margin: 4, errorCorrectionLevel: 'M',
  color: { dark: '#15334fff', light: '#ffffffff' }
}).then((data) => data, () => null) : Promise.resolve(null);

const root = path.join(__dirname, 'public');
const routes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/index.js', ['index.js', 'text/javascript; charset=utf-8']],
  ...['little-prince', 'totto-chan', 'secret-garden', 'eighty-days',
    'alice', 'pride-prejudice', 'sherlock', 'little-women',
    'anne', 'heidi', 'peter-pan', 'wizard-oz'].map((name) =>
    [`/images/${name}.png`, [`images/${name}.png`, 'image/png']])
]);

const dbPort = Number(process.env.DB_PORT);
const dbConfigured = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'].every((key) =>
  typeof process.env[key] === 'string' && process.env[key].length > 0) &&
  Number.isInteger(dbPort) && dbPort >= 1 && dbPort <= 65535;
const pool = dbConfigured ? mysql.createPool({
  host: process.env.DB_HOST, port: dbPort, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  connectionLimit: 4, queueLimit: 20, waitForConnections: true,
  dateStrings: true, charset: 'utf8mb4', connectTimeout: 5000,
  multipleStatements: false
}) : null;
const columns = 'id, title, author, reading_date AS `date`, pages, current_pages AS `current`, status, notes, version';
const idPattern = /^[a-fA-F0-9]{32}$/;
const maxBodyBytes = 64 * 1024;
class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const invalid = () => new RequestError(400, 'Invalid request');

function validateBook(body, creating) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
  const allowed = new Set(['title', 'author', 'date', 'pages', 'current', 'status', 'notes', creating ? 'id' : 'version']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw invalid();
  const values = {};
  for (const [key, limit] of [['title', 200], ['author', 160], ['notes', 5000]]) {
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > limit || body[key].includes('\u0000')) throw invalid();
    values[key] = body[key].trim();
  }
  if (typeof body.date !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(body.date)) throw invalid();
  const parsed = new Date(`${body.date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== body.date) throw invalid();
  if (!Number.isInteger(body.pages) || body.pages < 1 || body.pages > 100000 ||
      !Number.isInteger(body.current) || body.current < 0 || body.current > body.pages ||
      !['want', 'reading', 'done'].includes(body.status) ||
      (body.status === 'done' && body.current !== body.pages)) throw invalid();
  if (creating) {
    if (typeof body.id !== 'string' || !idPattern.test(body.id)) throw invalid();
  } else validateVersion(body.version);
  return { ...values, date: body.date, pages: body.pages, current: body.current, status: body.status };
}
function validateVersion(version) {
  if (!Number.isInteger(version) || version < 1 || version > 4294967295) throw invalid();
}
function bookParams(book) {
  return [book.title, book.author, book.date, book.pages, book.current, book.status, book.notes];
}

function checkWriteOrigin(req) {
  // Browser CSRF protection only, not authentication: this is a shared project diary.
  // Forwarded headers are intentionally ignored; Host never grants account privileges.
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new RequestError(403, 'Cross-origin write rejected');
  if (req.headers.origin !== undefined) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { throw invalid(); }
    const protocol = req.socket.encrypted ? 'https:' : 'http:';
    const effective = new URL(`${protocol}//${req.headers.host}`);
    const trustedProxyOrigin = shareUrl && origin.origin === new URL(shareUrl).origin;
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== req.headers.origin ||
        origin.host !== effective.host || (origin.protocol !== protocol && !trustedProxyOrigin)) {
      throw new RequestError(403, 'Cross-origin write rejected');
    }
  }
}
function readJson(req) {
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(req.headers['content-type'] || '') ||
      (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) throw invalid();
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maxBodyBytes)) throw invalid();
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) { reject(invalid()); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > maxBodyBytes) return;
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        resolve(JSON.parse(text));
      } catch { reject(invalid()); }
    });
    req.on('error', () => reject(invalid()));
    req.on('aborted', () => reject(invalid()));
  });
}

async function createBook(body, book) {
  const connection = await pool.getConnection();
  let locked = false;
  let transaction = false;
  let reusable = true;
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('reading_books_write', 5) AS acquired");
    if (Number(lock.acquired) !== 1) throw new RequestError(503, 'Storage unavailable');
    locked = true;
    await connection.beginTransaction();
    transaction = true;
    const [[count]] = await connection.query('SELECT COUNT(*) AS total FROM reading_books');
    if (Number(count.total) >= 500) throw new RequestError(409, 'Book limit reached');
    await connection.execute('INSERT INTO reading_books (id, title, author, reading_date, pages, current_pages, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [body.id, ...bookParams(book)]);
    const [[saved]] = await connection.execute(`SELECT ${columns} FROM reading_books WHERE id = ?`, [body.id]);
    await connection.commit();
    transaction = false;
    return saved;
  } finally {
    if (transaction) {
      try { await connection.rollback(); } catch { reusable = false; }
    }
    if (locked) {
      try {
        const [[released]] = await connection.query("SELECT RELEASE_LOCK('reading_books_write') AS released");
        if (Number(released.released) !== 1) reusable = false;
      } catch { reusable = false; }
    }
    if (reusable) connection.release(); else connection.destroy();
  }
}

async function changeBook(id, body, book, deleting) {
  const connection = await pool.getConnection();
  let transaction = false;
  let reusable = true;
  try {
    await connection.beginTransaction();
    transaction = true;
    const [[existing]] = await connection.execute('SELECT version FROM reading_books WHERE id = ? FOR UPDATE', [id]);
    if (!existing) throw new RequestError(404, 'Book not found');
    if (existing.version !== body.version || (!deleting && existing.version === 4294967295)) throw new RequestError(409, 'Book version conflict');
    const [result] = deleting
      ? await connection.execute('DELETE FROM reading_books WHERE id = ? AND version = ?', [id, body.version])
      : await connection.execute('UPDATE reading_books SET title = ?, author = ?, reading_date = ?, pages = ?, current_pages = ?, status = ?, notes = ?, version = version + 1 WHERE id = ? AND version = ?', [...bookParams(book), id, body.version]);
    if (result.affectedRows !== 1) throw new RequestError(409, 'Book version conflict');
    let saved;
    if (!deleting) [[saved]] = await connection.execute(`SELECT ${columns} FROM reading_books WHERE id = ?`, [id]);
    await connection.commit();
    transaction = false;
    return deleting ? { id } : { book: saved };
  } finally {
    if (transaction) {
      try { await connection.rollback(); } catch { reusable = false; }
    }
    if (reusable) connection.release(); else connection.destroy();
  }
}

// Only explicit assets are served; environment files and arbitrary paths are never exposed.
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
  const reply = (status, message) => {
    if (status >= 400 && !req.complete) res.setHeader('Connection', 'close');
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(message));
  };
  const methodNotAllowed = (methods) => {
    res.setHeader('Allow', methods);
    return reply(405, { error: 'Method not allowed' });
  };
  let pathname;
  try {
    if (!req.url || req.url.length > 2048 || !req.url.startsWith('/') || req.url.startsWith('//') ||
        !req.headers.host || req.headers.host.length > 255 || /[\s/\\?#@]/.test(req.headers.host)) throw invalid();
    new URL(`http://${req.headers.host}`);
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return reply(400, { error: 'Invalid URL' });
  }
  const bookRoute = pathname === '/api/books';
  const bookItem = /^\/api\/books\/([^/]+)$/.exec(pathname);
  if (bookRoute || bookItem || pathname === '/api/health') {
    try {
      if (pathname === '/api/health') {
        if (!['GET', 'HEAD'].includes(req.method)) return methodNotAllowed('GET, HEAD');
        if (!pool) throw new RequestError(503, 'Storage unavailable');
        await pool.query('SELECT 1');
        return reply(200, { status: 'ok', storage: 'mariadb' });
      }
      const allowed = bookRoute ? ['GET', 'POST'] : ['PUT', 'DELETE'];
      if (!allowed.includes(req.method)) return methodNotAllowed(allowed.join(', '));
      if (bookItem && !idPattern.test(bookItem[1])) throw invalid();
      if (req.method === 'GET') {
        if (!pool) throw new RequestError(503, 'Storage unavailable');
        const [books] = await pool.query(`SELECT ${columns} FROM reading_books ORDER BY created_at, id`);
        return reply(200, { books });
      }
      checkWriteOrigin(req);
      const body = await readJson(req);
      let book;
      if (req.method === 'DELETE') {
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).length !== 1 || !Object.hasOwn(body, 'version')) throw invalid();
        validateVersion(body.version);
      } else book = validateBook(body, req.method === 'POST');
      if (!pool) throw new RequestError(503, 'Storage unavailable');
      if (req.method === 'POST') return reply(201, { book: await createBook(body, book) });
      return reply(200, await changeBook(bookItem[1], body, book, req.method === 'DELETE'));
    } catch (error) {
      if (error instanceof RequestError) return reply(error.status, { error: error.message });
      if (error.code === 'ER_DUP_ENTRY') return reply(409, { error: 'Book already exists' });
      return reply(503, { error: 'Storage unavailable' });
    }
  }
  if (!['GET', 'HEAD'].includes(req.method)) return methodNotAllowed('GET, HEAD');
  if (pathname === '/api/share') return reply(200, { url: shareUrl });
  if (pathname === '/api/share/qr.png') {
    return shareQr.then((data) => {
      if (!data) return reply(503, { error: 'QR code is not configured or unavailable' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }
  const asset = routes.get(pathname);
  if (!asset) return reply(404, { error: 'Not found' });
  const filename = path.join(root, asset[0]);
  fs.realpath(filename, (error, resolved) => {
    if (error || resolved !== filename) return reply(404, { error: 'Not found' });
    fs.readFile(resolved, (readError, data) => {
      if (readError) return reply(500, { error: 'Unable to load asset' });
      res.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.maxConnections = 100;
server.on('error', () => {
  console.error('Server could not start; check HOST and PORT availability.');
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`MyReadingDiary listening on port ${port}`));
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async () => {
      try { if (pool) await pool.end(); } catch { process.exitCode = 1; }
    });
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
