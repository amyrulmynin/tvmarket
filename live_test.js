// Ujian: adakah TradingView hantar kemas kini candle forming secara live?
const https = require('https');
const crypto = require('crypto');

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

const sym = process.argv[2] || 'OANDA:XAUUSD';
const interval = process.argv[3] || '1';
const bars = parseInt(process.argv[4] || '60', 10);

const req = https.request({
  hostname: 'data.tradingview.com',
  path: '/socket.io/websocket?type=chart&from=2024-01-01',
  headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
    Origin: 'https://www.tradingview.com',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0.0.0 Safari/537.36' },
});
req.on('upgrade', (res, socket) => {
  let buf = Buffer.alloc(0);
  const send = (p) => socket.write(wsFrame(`~m~${p.length}~m~${p}`));
  setTimeout(() => send('~h~1'), 300);
  setTimeout(() => send(JSON.stringify({ m: 'chart_create_session', p: ['cs_x', ''] })), 700);
  setTimeout(() => send(JSON.stringify({ m: 'resolve_symbol',
    p: ['cs_x', 'sds_sym', `={"symbol":"${sym}","adjustment":"splits"}`] })), 1300);
  setTimeout(() => { send(JSON.stringify({ m: 'create_series',
    p: ['cs_x', 's1', 's1', 'sds_sym', interval, bars, ''] })); console.log('create_series ->', interval, bars); }, 2500);
  // также mintak quote update
  setTimeout(() => send(JSON.stringify({ m: 'quote_add_symbols', p: ['cs_x', sym] })), 2600);
  setTimeout(() => send(JSON.stringify({ m: 'quote_fast_symbols', p: ['cs_x', sym] })), 2700);

  let updates = 0;
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let off = 0;
    while (off + 2 <= buf.length) {
      const b1 = buf[off], b2 = buf[off + 1];
      const op = b1 & 0x0f;
      let len = b2 & 0x7f, p = off + 2;
      if (len === 126) { if (p + 2 > buf.length) return; len = buf.readUInt16BE(p); p += 2; }
      else if (len === 127) { if (p + 8 > buf.length) return; len = Number(buf.readBigUInt64BE(p)); p += 8; }
      if (p + len > buf.length) return;
      const pl = buf.subarray(p, p + len); off = p + len;
      if (op === 0x9) { socket.write(Buffer.concat([Buffer.from([0x8a, 0x80]), crypto.randomBytes(4)])); continue; }
      if (op !== 0x1) continue;
      const text = pl.toString('utf8');
      for (const part of text.split(/~m~\d+~m~/)) {
        if (!part.startsWith('{')) continue;
        let m; try { m = JSON.parse(part); } catch (e) { continue; }
        if (m.m === 'timescale_update') {
          updates++;
          const s = m.p[1].s1.s;
          const last = s[s.length - 1];
          console.log(`[update #${updates}] bars=${s.length} last=`, JSON.stringify(last.v));
        } else if (m.m === 'qsd' || m.m === 'qsd_update') {
          console.log('QSD:', JSON.stringify(m.p).slice(0, 200));
        } else if (m.m === 'quote_completed') {
          console.log('quote_completed:', JSON.stringify(m.p).slice(0, 200));
        } else if (m.m === 'symbol_error' || m.m === 'critical_error') {
          console.log('ERROR:', part.slice(0, 200));
        }
      }
    }
  });
  setTimeout(() => { console.log('TOTAL updates dalam 40s:', updates); process.exit(0); }, 40000);
});
req.on('error', (e) => { console.log('ERR', e.message); process.exit(1); });
req.end();
