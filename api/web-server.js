// TV Market Web — serve UI build + proxy /api/* ke backend (8081).
// Satu origin untuk web: tiada CORS, tiada API key bocor ke browser
// (proxy inject key dari env), HTTPS diselia oleh Cloudflare Tunnel.
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.json': 'application/json', '.woff2': 'font/woff2',
};

const PORT = process.env.PORT || 8090;
const API = 'http://127.0.0.1:8081';
const KEY = process.env.TV_API_KEY || '';
const DIST = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'web');
const FALLBACK_API_HOSTS = [
  'https://tvmarket-api.mudahpays.my.id',
  'https://maine-roulette-throws-qty.trycloudflare.com',
  'http://43.134.97.197:8080',
];

function proxyApi(req, res) {
  const u = new URL(req.url, 'http://x');
  const tUrl = new URL(API + u.pathname + u.search);
  if (KEY && !tUrl.searchParams.has('key')) tUrl.searchParams.set('key', KEY);
  const preq = http.request(tUrl, {
    method: req.method,
    headers: { 'Accept': 'application/json' },
    timeout: 120000,
  }, (pres) => {
    res.writeHead(pres.statusCode || 502, {
      'Content-Type': pres.headers['content-type'] || 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    pres.pipe(res);
  });
  preq.on('error', () => { res.writeHead(502); res.end('{"error":"upstream"}'); });
  req.pipe(preq);
}

function serveIndex(req, res, pathname) {
  const file = path.join(DIST, pathname === '/' || pathname === '/index.html' ? 'index.html' : pathname);
  if (pathname !== '/' && pathname !== '/index.html' && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    return fs.createReadStream(file).pipe(res);
  }
  let html;
  try {
    html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  } catch (e) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('UI belum dibina. Jalankan npm run build dahulu.');
  }
  const hostsJson = JSON.stringify(FALLBACK_API_HOSTS);
  const script = `<script>window.__TV_API_HOSTS = ${hostsJson};</script>`;
  html = html.replace('</head>', script + '</head>');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) return proxyApi(req, res);
  return serveIndex(req, res, u.pathname);
});

server.listen(PORT, '127.0.0.1', () => console.log(`tvmarket-web on :${PORT}`));
