/**
 * TV Market API v2 — live candle + quote streaming (SSE)
 * Zero dependency. Node >= 18.
 *
 *   PORT=8081 node server-live.js
 *
 * Endpoints:
 *   GET /api/live?symbol=OANDA:XAUUSD&interval=1&bars=120   -> snapshot cache
 *   GET /api/stream?symbol=...&interval=...&bars=...          -> SSE (candles + quote)
 *   GET /api/quote?symbol=...        -> scanner quote sekali
 *   GET /api/candles?symbol=...      -> candle sekali (snapshot websocket)
 *   GET /api/search?q=gold
 *   GET /api/health
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const bystra = require('./bystra.js');

const PORT = parseInt(process.env.PORT || '8081', 10);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const REGION = (ex) => {
  const e = (ex || '').toUpperCase();
  if (['OANDA', 'TVC', 'FX_IDC', 'FOREX', 'FX', 'SAXO', 'FXCM'].includes(e)) return 'global';
  if (['BITSTAMP', 'BINANCE', 'COINBASE', 'CRYPTO', 'KRAKEN', 'BYBIT'].includes(e)) return 'crypto';
  if (e === 'LSE') return 'uk';
  if (['XETR', 'FWB'].includes(e)) return 'germany';
  if (e === 'TSE') return 'japan';
  if (['NSE', 'BSE'].includes(e)) return 'india';
  return 'america';
};
const API_KEY = process.env.TV_API_KEY || '';
// Timeframe lebih tinggi untuk pengesahan direction (Bystra: HTF confirm LTF).
const HTF_OF = {
  '1': '5', '5': '15', '15': '60', '60': '240', '240': '1D', '1D': '1W',
};
const normSymbol = (s) => {
  if (!s) return 'OANDA:XAUUSD';
  s = s.trim().toUpperCase();
  if (!s.includes(':')) s = 'OANDA:' + s;
  return s;
};

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json',
        'Origin': 'https://www.tradingview.com', 'Referer': 'https://www.tradingview.com/' },
    }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': UA, 'Origin': 'https://www.tradingview.com',
        'Referer': 'https://www.tradingview.com/' },
    }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function getQuote(symbol) {
  const sym = normSymbol(symbol);
  const region = REGION(sym.split(':')[0]);
  const body = JSON.stringify({
    symbols: { tickers: [sym], query: { types: [] } },
    columns: ['name', 'close', 'change', 'volume', 'high', 'low', 'open'],
  });
  const r = await httpsPost(`https://scanner.tradingview.com/${region}/scan`, body);
  if (r.status !== 200) throw new Error(`scanner HTTP ${r.status}`);
  const o = JSON.parse(r.body);
  if (!o.data || !o.data.length) throw new Error('simbol tidak dijumpai');
  const d = o.data[0].d;
  return {
    symbol: sym, name: d[0], price: d[1], changePercent: d[2],
    volume: d[3], high: d[4], low: d[5], open: d[6],
  };
}

function wsFrame(text) {
  const data = Buffer.from(text, 'utf8');
  let header;
  if (data.length < 126) header = Buffer.from([0x81, 0x80 | data.length]);
  else if (data.length < 65536) header = Buffer.from([0x81, 0x80 | 126, (data.length >> 8) & 0xff, data.length & 0xff]);
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

// ====== State live (satu simbol aktif, cache + SSE broadcast) ======
const state = {
  symbol: 'OANDA:XAUUSD',
  interval: '1',
  bars: 120,
  candles: [],
  quote: null,
  lastCandleAt: 0,
  listeners: new Set(),
  socket: null,
  req: null,
  retry: null,
  seeding: false,
};

function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of state.listeners) {
    try { res.write(msg); } catch (e) { state.listeners.delete(res); }
  }
}

function stopStream() {
  if (state.retry) { clearTimeout(state.retry); state.retry = null; }
  if (state.socket) { try { state.socket.destroy(); } catch (e) {} state.socket = null; }
  if (state.req) { try { state.req.destroy(); } catch (e) {} state.req = null; }
}

function parseFrames(buf, onText) {
  let off = 0;
  while (off + 2 <= buf.length) {
    const b1 = buf[off], b2 = buf[off + 1];
    const opcode = b1 & 0x0f;
    let len = b2 & 0x7f, p = off + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    if (p + len > buf.length) break;
    const payload = buf.subarray(p, p + len);
    off = p + len;
    if (opcode === 0x9) continue; // ping (server -> client, balas di socket handler)
    if (opcode !== 0x1) continue;
    onText(payload.toString('utf8'));
  }
  return buf.subarray(off);
}

function startStream(symbol, interval, bars) {
  const same = state.socket && state.symbol === symbol
    && state.interval === interval && state.bars === bars;
  if (same) return; // sudah streaming config yang sama, jangan reset
  const configChanged = state.symbol !== symbol || state.interval !== interval;
  stopStream();
  state.symbol = symbol;
  state.interval = interval;
  state.bars = bars;
  // Kalau simbol/interval bertukar, kosongkan cache lalu seed dari snapshot
  // segera supaya UI tak tunggu handshake penuh.
  if (configChanged) {
    state.candles = [];
    setTimeout(() => seedFromSnapshot(symbol, interval, bars), 500);
  }
  state.lastCandleAt = Date.now();

  const req = https.request({
    hostname: 'data.tradingview.com',
    path: '/socket.io/websocket?type=chart&from=2024-01-01',
    method: 'GET',
    headers: {
      'Connection': 'Upgrade', 'Upgrade': 'websocket', 'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
      'Origin': 'https://www.tradingview.com', 'User-Agent': UA,
    },
  });
  state.req = req;

  let upgradeDone = false;

  req.on('upgrade', (res, socket) => {
    upgradeDone = true;
    state.socket = socket;
    let buf = Buffer.alloc(0);
    const send = (p) => { try { socket.write(wsFrame(`~m~${p.length}~m~${p}`)); } catch (e) {} };

    setTimeout(() => send('~h~1'), 200);
    setTimeout(() => send(JSON.stringify({ m: 'chart_create_session', p: ['cs_x', ''] })), 600);
    setTimeout(() => send(JSON.stringify({ m: 'resolve_symbol',
      p: ['cs_x', 'sds_sym', `={"symbol":"${symbol}","adjustment":"splits"}`] })), 1200);
    setTimeout(() => send(JSON.stringify({ m: 'create_series',
      p: ['cs_x', 's1', 's1', 'sds_sym', interval, bars, ''] })), 2000);

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      buf = parseFrames(buf, (text) => {
        // TradingView hantar heartbeat ~h~N — WAJIB di-echo, jika tidak
        // server tutup sambungan selepas beberapa saat (punca stream mati senyap).
        const hb = text.match(/^~h~(\d+)$/);
        if (hb) { send(`~h~${hb[1]}`); return; }

        for (const part of text.split(/~m~\d+~m~/)) {
          if (!part.startsWith('{')) continue;
          let m; try { m = JSON.parse(part); } catch (e) { continue; }
          if (m.m === 'timescale_update' || m.m === 'du') {
            try {
              const series = m.p[1].s1.s;
              const out = series.map((b) => ({
                time: Math.round(b.v[0]), open: b.v[1], high: b.v[2],
                low: b.v[3], close: b.v[4], volume: b.v[5],
              }));
              if (!out.length) return;
              // TradingView hantar dua bentuk 'timescale_update':
              //  (a) history penuh (out.length ~ bars) -> ganti cache
              //  (b) forming bar (out.length 1-2) -> update candle terakhir
              // 'du' sentiasa delta (forming bar). Jangan benarkan frame kecil
              // menggantikan cache penuh.
              const before = state.candles.length;
              const isDelta = m.m === 'du' || out.length < Math.max(20, Math.floor(state.bars / 2));
              if (isDelta) {
                if (state.candles.length < 20) {
                  // cache belum ada history penuh -> seed dari snapshot
                  state.lastCandleAt = Date.now();
                  if (state.candles.length) state.candles = mergeLast(state.candles, out);
                  else seedFromSnapshot(symbol, interval, bars);
                  return;
                }
                state.candles = mergeLast(state.candles, out);
              } else {
                state.candles = out;
              }
              state.lastCandleAt = Date.now();
              console.log(`[tv] ${m.m} bars=${out.length} delta=${isDelta} cache=${before}->${state.candles.length}`);
              broadcast('candles', { symbol: state.symbol, interval: state.interval, candles: state.candles });
              const last = state.candles[state.candles.length - 1];
              // Gabung dengan quote scanner yang ada; kekalkan changePercent
              // daripada scanner (lebih tepat), guna harga candle untuk price.
              state.quote = {
                symbol: state.symbol,
                name: state.quote?.name || state.symbol.split(':')[1],
                price: last.close,
                changePercent: state.quote?.changePercent ?? 0,
                volume: last.volume, high: last.high, low: last.low, open: last.open,
                source: 'candle',
              };
              broadcast('quote', state.quote);
            } catch (e) {}
          } else if (m.m === 'symbol_error' || m.m === 'critical_error') {
            if (part.includes('unsupported')) return;
            broadcast('error', { error: 'simbol tidak sah: ' + symbol });
          }
        }
      });
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      if (state.socket === socket) state.socket = null;
      scheduleRetry(); // sentiasa cuba semula, walaupun tiada listener
    });
  });

  req.on('error', () => scheduleRetry());
  // Timeout hanya untuk fasa handshake. Setelah upgrade, koneksi mesti kekal
  // — req.destroy() akan killing socket although req.setTimeout(0) dipanggil.
  req.setTimeout(30000, () => {
    if (upgradeDone) return; // koneksi sudah jadi websocket, jangan bunuh
    try { req.destroy(); } catch (e) {}
  });
  req.end();
}

// Seed cache daripada snapshot sekali (websocket berasingan) bila stream utama
// hanya menghantar 'du' (delta forming bar) tanpa timescale_update penuh.
async function seedFromSnapshot(symbol, interval, bars) {
  if (state.seeding) return;
  state.seeding = true;
  try {
    const snap = await snapshotCandles(symbol, interval, bars);
    if (snap && snap.candles && snap.candles.length >= 20) {
      // gabung: kekalkan forming bar terkini jika lebih baru
      const merged = mergeLast(snap.candles, state.candles);
      state.candles = merged;
      state.lastCandleAt = Date.now();
      console.log(`[tv] seed dari snapshot: ${snap.candles.length} bar`);
      broadcast('candles', { symbol: state.symbol, interval: state.interval, candles: state.candles });
    }
  } catch (e) {
    console.log(`[tv] seed gagal: ${e.message}`);
  } finally {
    state.seeding = false;
  }
}

// Gabung candle delta ('du' frame) dengan cache sedia ada
function mergeLast(prev, incoming) {
  if (!prev.length) return incoming;
  const map = new Map(prev.map((c) => [c.time, c]));
  for (const c of incoming) map.set(c.time, c);
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

// Watchdog: kalau tiada candle > 45s sedangkan socket 'terbuka', paksa sambung semula
setInterval(() => {
  const stale = Date.now() - state.lastCandleAt > 45000;
  if (stale && state.socket) {
    try { state.socket.destroy(); } catch (e) {}
    state.socket = null;
    scheduleRetry();
  }
}, 15000);

function scheduleRetry() {
  if (state.retry) return;
  state.retry = setTimeout(() => {
    state.retry = null;
    if (state.listeners.size) startStream(state.symbol, state.interval, state.bars);
  }, 4000);
}

// Scanner price — update setiap 5s untuk.changePercentage yang tepat
setInterval(async () => {
  try {
    if (state.quote && state.quote.source === 'candle') {
      const q = await getQuote(state.symbol);
      state.quote = { ...state.quote, ...q, source: 'scanner+candle' };
      broadcast('quote', state.quote);
    }
  } catch (e) {}
}, 5000);

// ====== Router ======
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    });
    return res.end();
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'kaedah tidak dibenarkan' });

  // ====== Auth: API key (jika TV_API_KEY diset) ======
  // Terima ?key=, header X-API-Key, atau Authorization: Bearer
  if (API_KEY && u.pathname !== '/api/health') {
    const given =
      u.searchParams.get('key') ||
      req.headers['x-api-key'] ||
      (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (given !== API_KEY) {
      return json(res, 401, { error: 'API key tidak sah', hint: 'Hantar ?key=... atau header X-API-Key' });
    }
  }

  const sym = normSymbol(u.searchParams.get('symbol'));
  const interval = u.searchParams.get('interval') || '1';
  const bars = Math.min(parseInt(u.searchParams.get('bars') || '120', 10), 5000);

  try {
    if (u.pathname === '/api/health') {
      return json(res, 200, { ok: true, time: new Date().toISOString(), stream: !!state.socket, listeners: state.listeners.size });
    }
    if (u.pathname === '/api/quote') {
      return json(res, 200, await getQuote(sym));
    }
    if (u.pathname === '/api/live') {
      if (sym !== state.symbol || interval !== state.interval || bars !== state.bars) {
        startStream(sym, interval, bars);
      }
      return json(res, 200, {
        symbol: state.symbol, interval: state.interval,
        quote: state.quote, candles: state.candles,
        updatedAt: state.lastCandleAt,
      });
    }
    if (u.pathname === '/api/stream') {
      if (sym !== state.symbol || interval !== state.interval || bars !== state.bars) {
        startStream(sym, interval, bars);
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      state.listeners.add(res);
      res.write(`event: candles\ndata: ${JSON.stringify({ symbol: state.symbol, interval: state.interval, candles: state.candles })}\n\n`);
      if (state.quote) res.write(`event: quote\ndata: ${JSON.stringify(state.quote)}\n\n`);
      const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
      req.on('close', () => { clearInterval(hb); state.listeners.delete(res); });
      return;
    }
    if (u.pathname === '/api/candles') {
      // snapshot sekali guna getCandles yang lebih ringan (sambungan baru)
      return json(res, 200, await snapshotCandles(sym, u.searchParams.get('interval') || '1D', bars));
    }
    if (u.pathname === '/api/bystra') {
      // Analisis penunjuk kaedah Bystra: ambil candle LTF + HTF (confirmation),
      // lalu kira direction, SNR, setup, entry/SL/TP, confidence %.
      // Scalping (m1/m5) — rujukan paksa m15 sebagai pengesahan direction/HTF.
      const iv = u.searchParams.get('interval') || '60';
      const scan = u.searchParams.get('scan') === '1';
      const useHtf = u.searchParams.get('htf') !== '0';
      const scalpMode = (iv === '1' || iv === '5');
      const htfTarget = scalpMode ? '15' : (HTF_OF[iv] || null);
      // Mod scan: default window 1 hari penuh (m1=1440, m5=576≈2 hari) supaya
      // "sehari pasti ada signal" sentiasa boleh disahkan.
      const defBars = scan ? (iv === '1' ? 1440 : iv === '5' ? 576 : 120) : 120;
      const n = Math.min(parseInt(u.searchParams.get('bars') || String(defBars), 10), 5000);
      const snap = await snapshotCandles(sym, iv, n);
      let htfConfirm = null;
      let htfTrend = null;
      let htfDirection = null;
      let htfIv = null;
      if (useHtf) {
        try {
          const hiv = htfTarget;
          if (hiv) {
            htfIv = hiv;
            const hs = await snapshotCandles(sym, hiv, Math.min(n, 120));
            const hr = bystra.analyze(hs.candles, { interval: hiv });
            if (hr.ok) {
              htfTrend = hr.trend;
              htfDirection = hr.direction || null;
              htfConfirm = hr.trend === 'up' ? 'bull' : hr.trend === 'down' ? 'bear' : null;
              if (!htfConfirm && hr.direction) htfConfirm = hr.direction.bias;
            }
          }
        } catch (e) { /* HTF gagal tidak halang LTF */ }
      }
      // Buang forming bar (candle terakhir belum tutup) — analysis mesti pada
      // candle yang sudah sah, bukan harga yang masih bergerak. Ini punca
      // entry/SL/TP/arah berubah-ubah setiap poll.
      const closed = snap.candles[snap.candles.length - 1];
      const lastClosedTs = closed.time > 1e11 ? Math.round(closed.time / 1000) : closed.time;
      const nowSec = Math.floor(Date.now() / 1000);
      const ivSec = { '1': 60, '5': 300, '15': 900, '60': 3600, '240': 14400, '1D': 86400 }[iv] || 3600;
      let arr = snap.candles;
      if (lastClosedTs + ivSec > nowSec) {
        arr = snap.candles.slice(0, -1); // candle terakhir masih forming — buang
      }
      if (arr.length < 30) arr = snap.candles; // fallback: data terlalu pendek
      const report = bystra.analyze(arr, {
        symbol: snap.symbol, interval: iv, htfConfirm,
      });

      // SISD (Nora) — Direction (DMD) di HTF + setup searah di LTF, dalam zon DMD HTF.
      // Setup mesti berada di dalam / berhampiran zon DMD HTF (beri toleransi 1.5 ATR LTF).
      if (htfDirection && htfDirection.zone && report.ok) {
        const hz = htfDirection.zone;
        const lAtr = report.atr || 1;
        const tol = lAtr * 1.5;
        const nested = (report.setups || []).filter((s) =>
          s.bias === htfDirection.bias && (
            (s.zone && Math.min(s.zone.top, hz.top + tol) - Math.max(s.zone.bottom, hz.bottom - tol) > 0) ||
            (s.level != null && s.level >= hz.bottom - tol && s.level <= hz.top + tol) ||
            (report.price >= hz.bottom - tol && report.price <= hz.top + tol)
          )
        );
        if (nested.length) {
          report.sisd = [{
            name: 'SISD', bias: htfDirection.bias, directionType: htfDirection.type,
            htf: htfIv, ltf: iv, inner: nested.slice(0, 3).map((x) => x.name),
            zone: hz,
          }];
          // SISD merentas TF = kualiti tertinggi: naikkan keyakinan plan jika searah
          if (report.plan && report.plan.bias === htfDirection.bias) {
            report.plan.confidence = Math.min(98, report.plan.confidence + 8);
            report.plan.sisd = true;
          }
        }
      }
      return json(res, 200, {
        ...report,
        htf: { interval: htfTarget, trend: htfTrend, direction: htfDirection },
        ...(scan ? (() => {
          // Mod scalping: senarai SEMUA signal dalam tempoh (1 hari m1 = 1440 bar).
          // Jaminan ">1 signal sehari": jika pada minConf tak ada signal dalam hari
          // terkini, longgar minConf bertahap (60→55→45) sehingga dapat sekurang-kurangnya
          // 2 signal. Pastikan selalu ada sesuatu untuk scalping harian.
          let minConf = parseInt(u.searchParams.get('minconf') || '55', 10);
          let sc = bystra.scanSignals(snap.candles, { htfConfirm, minConf, interval: iv });
          let fallbackConf = null;
          const dayStart = Math.floor((snap.candles[snap.candles.length - 1].time > 1e11
            ? snap.candles[snap.candles.length - 1].time / 1000
            : snap.candles[snap.candles.length - 1].time) / 86400) * 86400;
          const today = (sc.ok ? sc.signals : []).filter((s) => s.time >= dayStart);
          if (sc.ok && today.length < 2) {
            for (const lv of [Math.min(minConf, 55), 45]) {
              if (lv >= minConf) continue;
              const sc2 = bystra.scanSignals(snap.candles, { htfConfirm, minConf: lv, interval: iv });
              const t2 = (sc2.ok ? sc2.signals : []).filter((s) => s.time >= dayStart);
              if (t2.length >= 2) { sc = sc2; fallbackConf = lv; break; }
            }
          }
          return {
            scan: sc.ok ? sc.signals : [],
            scanStats: { ...(sc.stats || null), fallbackConf, todaySignals: (sc.ok ? sc.signals : []).filter((s) => s.time >= dayStart).length },
            scanError: sc.error || null,
          };
        })() : {}),
      });
    }
    if (u.pathname === '/api/search') {
      const q = u.searchParams.get('q');
      if (!q) return json(res, 400, { error: 'parameter q diperlukan' });
      return json(res, 200, { query: q, results: await search(q) });
    }
    if (u.pathname === '/') {
      return json(res, 200, {
        name: 'TV Market API v2 — live',
        endpoints: ['/api/health', '/api/live', '/api/stream?symbol=OANDA:XAUUSD&interval=1&bars=120',
          '/api/quote?symbol=OANDA:XAUUSD', '/api/candles?symbol=OANDA:XAUUSD',
          '/api/bystra?symbol=OANDA:XAUUSD&interval=60&bars=120', '/api/search?q=gold'],
      });
    }
    return json(res, 404, { error: 'laluan tidak dijumpai' });
  } catch (e) {
    return json(res, 502, { error: e.message });
  }
});

// Snapshot candle sekali (sambungan websocket baru, tutup selepas dapat data)
function snapshotCandles(symbol, interval, bars) {
  return new Promise((resolve, reject) => {
    const sym = normSymbol(symbol);
    const req = https.request({
      hostname: 'data.tradingview.com',
      path: '/socket.io/websocket?type=chart&from=2024-01-01',
      headers: { 'Connection': 'Upgrade', 'Upgrade': 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Origin': 'https://www.tradingview.com', 'User-Agent': UA },
    });
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; try { req.destroy(); } catch (e) {} fn(v); } };
    req.setTimeout(20000, () => finish(reject, new Error('websocket timeout')));
    req.on('error', (e) => finish(reject, e));
    req.on('upgrade', (res, socket) => {
      let buf = Buffer.alloc(0);
      const send = (p) => socket.write(wsFrame(`~m~${p.length}~m~${p}`));
      setTimeout(() => send('~h~1'), 200);
      setTimeout(() => send(JSON.stringify({ m: 'chart_create_session', p: ['cs_x', ''] })), 600);
      setTimeout(() => send(JSON.stringify({ m: 'resolve_symbol', p: ['cs_x', 'sds_sym', `={"symbol":"${sym}","adjustment":"splits"}`] })), 1200);
      setTimeout(() => send(JSON.stringify({ m: 'create_series', p: ['cs_x', 's1', 's1', 'sds_sym', interval, bars, ''] })), 2000);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        buf = parseFrames(buf, (text) => {
          for (const part of text.split(/~m~\d+~m~/)) {
            if (!part.startsWith('{')) continue;
            let m; try { m = JSON.parse(part); } catch (e) { continue; }
            if (m.m === 'timescale_update') {
              try {
                const s = m.p[1].s1.s;
                finish(resolve, { symbol: sym, interval, bars: s.length, candles: s.map((b) => ({
                  time: Math.round(b.v[0]), open: b.v[1], high: b.v[2], low: b.v[3], close: b.v[4], volume: b.v[5],
                })) });
              } catch (e) { finish(reject, new Error('format candle tidak dijangka')); }
            } else if (m.m === 'symbol_error' || m.m === 'critical_error') {
              if (!part.includes('unsupported')) finish(reject, new Error('simbol tidak sah'));
            }
          }
        });
      });
      socket.on('error', (e) => finish(reject, e));
    });
    req.end();
  });
}

async function search(q) {
  const url = `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(q)}&hl=1&exchange=&lang=en&search_type=&domain=production`;
  const r = await httpsGet(url);
  if (r.status !== 200) throw new Error(`search HTTP ${r.status}`);
  const o = JSON.parse(r.body);
  const clean = (s) => (s || '').replace(/<\/?em>/g, '');
  return (o.symbols || []).slice(0, 30).map((s) => ({
    symbol: `${s.prefix ? s.prefix + ':' : ''}${clean(s.symbol)}`,
    description: clean(s.description), exchange: s.exchange, type: s.type,
  }));
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TV Market API v2 (live) di http://0.0.0.0:${PORT}`);
  // Start stream secara automatik supaya cache sedia bila client connect
  startStream(state.symbol, state.interval, state.bars);
});
