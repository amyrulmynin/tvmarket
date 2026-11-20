/**
 * TV Market API — pembalut (wrapper) data TradingView
 * Tiada dependency luar. Node.js >= 18.
 *
 *   node server.js            (port 8080)
 *   PORT=3000 node server.js
 *
 * Endpoints:
 *   GET /api/quote?symbol=OANDA:XAUUSD
 *   GET /api/candles?symbol=OANDA:XAUUSD&interval=1D&bars=300
 *   GET /api/search?q=gold
 *   GET /api/health
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8080', 10);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ---------- util ----------
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

const normSymbol = (s) => {
  if (!s) return '';
  s = s.trim().toUpperCase();
  if (!s.includes(':')) s = 'OANDA:' + s;
  return s;
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json',
        'Origin': 'https://www.tradingview.com', 'Referer': 'https://www.tradingview.com/', ...headers },
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

// ---------- quote via scanner ----------
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
    symbol: sym,
    name: d[0],
    price: d[1],
    changePercent: d[2],
    volume: d[3],
    high: d[4],
    low: d[5],
    open: d[6],
  };
}

// ---------- candle via websocket ----------
function wsFrame(text) {
  const data = Buffer.from(text, 'utf8');
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x81, 0x80 | data.length]);
  } else if (data.length < 65536) {
    header = Buffer.from([0x81, 0x80 | 126, (data.length >> 8) & 0xff, data.length & 0xff]);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

function getCandles(symbol, interval = '1D', bars = 300) {
  return new Promise((resolve, reject) => {
    const sym = normSymbol(symbol);
    const req = https.request({
      hostname: 'data.tradingview.com',
      path: '/socket.io/websocket?type=chart&from=2024-01-01',
      method: 'GET',
      headers: {
        'Connection': 'Upgrade', 'Upgrade': 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Origin': 'https://www.tradingview.com', 'User-Agent': UA,
      },
    });
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; try { req.destroy(); } catch (e) {} fn(v); } };

    req.setTimeout(20000, () => finish(reject, new Error('websocket timeout')));
    req.on('error', (e) => finish(reject, e));

    req.on('upgrade', (res, socket) => {
      let buf = Buffer.alloc(0);
      let phase = 0;

      const send = (payload) => socket.write(wsFrame(`~m~${payload.length}~m~${payload}`));

      const tick = () => {
        if (phase === 0) {
          send('~h~1');
          setTimeout(() => {
            send(JSON.stringify({ m: 'chart_create_session', p: ['cs_x', ''] }));
            phase = 1;
            setTimeout(() => {
              send(JSON.stringify({ m: 'resolve_symbol',
                p: ['cs_x', 'sds_sym', `={"symbol":"${sym}","adjustment":"splits"}`] }));
              phase = 2;
              setTimeout(() => {
                send(JSON.stringify({ m: 'create_series',
                  p: ['cs_x', 's1', 's1', 'sds_sym', interval, bars, ''] }));
                phase = 3;
              }, 1200);
            }, 600);
          }, 400);
        }
      };

      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        let offset = 0;
        while (offset + 2 <= buf.length) {
          const b1 = buf[offset];
          const b2 = buf[offset + 1];
          const opcode = b1 & 0x0f;
          let len = b2 & 0x7f;
          let p = offset + 2;
          if (len === 126) { if (p + 2 > buf.length) return; len = buf.readUInt16BE(p); p += 2; }
          else if (len === 127) { if (p + 8 > buf.length) return; len = Number(buf.readBigUInt64BE(p)); p += 8; }
          if (p + len > buf.length) return;
          const payload = buf.subarray(p, p + len);
          offset = p + len;

          if (opcode === 0x9) { // ping -> pong
            socket.write(Buffer.concat([Buffer.from([0x8a, 0x80]), crypto.randomBytes(4)]));
            continue;
          }
          if (opcode !== 0x1) continue;

          const text = payload.toString('utf8');
          for (const part of text.split(/~m~\d+~m~/)) {
            if (!part.startsWith('{')) continue;
            let msg;
            try { msg = JSON.parse(part); } catch (e) { continue; }
            if (msg.m === 'timescale_update') {
              try {
                const series = msg.p[1].s1.s;
                const out = series.map((b) => ({
                  time: Math.round(b.v[0]),
                  open: b.v[1], high: b.v[2], low: b.v[3], close: b.v[4], volume: b.v[5],
                }));
                finish(resolve, { symbol: sym, interval, bars: out.length, candles: out });
              } catch (e) { finish(reject, new Error('format candle tidak dijangka')); }
            } else if (msg.m === 'symbol_error' || msg.m === 'critical_error') {
              finish(reject, new Error('simbol tidak sah: ' + sym));
            }
          }
        }
      });

      socket.on('error', (e) => finish(reject, e));
      tick();
    });

    req.end();
  });
}

// ---------- symbol search ----------
async function search(q) {
  const url = `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(q)}&hl=1&exchange=&lang=en&search_type=&domain=production`;
  const r = await httpsGet(url);
  if (r.status !== 200) throw new Error(`search HTTP ${r.status}`);
  const o = JSON.parse(r.body);
  const clean = (s) => (s || '').replace(/<\/?em>/g, '');
  return (o.symbols || []).slice(0, 30).map((s) => ({
    symbol: `${s.prefix ? s.prefix + ':' : ''}${clean(s.symbol)}`,
    description: clean(s.description),
    exchange: s.exchange,
    type: s.type,
  }));
}

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'kaedah tidak dibenarkan' });

  try {
    if (u.pathname === '/api/health') {
      return json(res, 200, { ok: true, time: new Date().toISOString() });
    }
    if (u.pathname === '/api/quote') {
      const sym = u.searchParams.get('symbol');
      if (!sym) return json(res, 400, { error: 'parameter symbol diperlukan' });
      return json(res, 200, await getQuote(sym));
    }
    if (u.pathname === '/api/candles') {
      const sym = u.searchParams.get('symbol');
      if (!sym) return json(res, 400, { error: 'parameter symbol diperlukan' });
      const interval = u.searchParams.get('interval') || '1D';
      const bars = Math.min(parseInt(u.searchParams.get('bars') || '300', 10), 5000);
      return json(res, 200, await getCandles(sym, interval, bars));
    }
    if (u.pathname === '/api/search') {
      const q = u.searchParams.get('q');
      if (!q) return json(res, 400, { error: 'parameter q diperlukan' });
      return json(res, 200, { query: q, results: await search(q) });
    }
    if (u.pathname === '/' ) {
      return json(res, 200, {
        name: 'TV Market API',
        endpoints: ['/api/health', '/api/quote?symbol=OANDA:XAUUSD',
          '/api/candles?symbol=OANDA:XAUUSD&interval=1D&bars=300', '/api/search?q=gold'],
      });
    }
    return json(res, 404, { error: 'laluan tidak dijumpai' });
  } catch (e) {
    return json(res, 502, { error: e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TV Market API berjalan di http://0.0.0.0:${PORT}`);
});
