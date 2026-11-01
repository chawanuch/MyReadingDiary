'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');

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

// Only explicit assets are served; environment files and arbitrary paths are never exposed.
const server = http.createServer((req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
  const reply = (status, message) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(message));
  };
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return reply(405, { error: 'Method not allowed' });
  }
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return reply(400, { error: 'Invalid URL' });
  }
  if (pathname === '/api/health') return reply(200, { status: 'ok', storage: 'browser-local' });
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
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close();
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
