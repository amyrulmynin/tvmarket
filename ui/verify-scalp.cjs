// Sahkan panel SCALP (m1/m5) memaparkan senarai signal harian + entry/SL/TP/conf.
const fs = require('node:fs')
const { JSDOM } = require('jsdom')

const html = fs.readFileSync('../app/src/main/assets/web/index.html', 'utf8')

const nowS = Math.floor(Date.now() / 1000)
const dayStart = Math.floor(nowS / 86400) * 86400
const mk = (i, name, bias, conf, entry, sl, tp1, off) => ({
  name, bias, kind: 'continuation', risk: 'low',
  i, time: dayStart + off, ageBars: 3, status: off > 3600 ? 'closed' : 'fresh',
  ck: 'CK1', conf, session: off < 7 * 3600 ? 'Asia' : 'London',
  entry, sl, tp1, tp2: bias === 'bull' ? entry + Math.abs(entry - sl) * 2 : entry - Math.abs(entry - sl) * 2,
  riskPips: Math.abs(entry - sl), rr2: 2, snr: entry, engulfing: 'type1',
  level: entry, zone: { top: entry, bottom: sl },
})
const MOCK_SCALP = {
  ok: true, price: 3550, atr: 4.5, trend: 'down',
  direction: { type: 'DMD2', bias: 'bear', zone: { top: 3560, bottom: 3550 } },
  plan: { bias: 'bear', setup: 'QMC', ck: 'CK1', entry: 3550, sl: 3565, tp1: 3535,
    tp2: 3520, riskPips: 15, rr1: 1, rr2: 2, confidence: 81, atr: 4.5 },
  htf: { interval: '15', trend: 'down' },
  scan: [
    mk(10, 'QMC', 'bear', 78, 3552.1, 3566.3, 3537.9, 3600),
    mk(25, 'SNRC1', 'bull', 66, 3548.5, 3540.2, 3556.8, 7200),
    mk(40, 'QMC', 'bear', 82, 3545.3, 3559.6, 3531.0, 14400),
    mk(55, 'SNRC2', 'bull', 71, 3541.7, 3533.1, 3550.3, 21600),
  ],
  scanStats: { total: 92, raw: 349, bulls: 9, bears: 83, active: 0, fresh: 2,
    minConf: 60, clusterBars: 10, sessions: { Asia: 46, London: 15, 'NY-AM': 17, 'NY-PM': 14 },
    fallbackConf: null, todaySignals: 4 },
}

const errors = []
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'file:///android_asset/web/index.html',
  beforeParse(win) {
    win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
    win.requestAnimationFrame = (cb) => setTimeout(cb, 16)
    win.cancelAnimationFrame = clearTimeout
    win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
    win.fetch = (url) => {
      if (String(url).includes('/api/bystra')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_SCALP) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ candles: [], quote: null }) })
    }
    win.HTMLCanvasElement.prototype.getContext = function () {
      const noop = () => {}
      return new Proxy({}, { get: (t, p) => {
        if (p === 'measureText') return () => ({ width: 10 })
        if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop })
        return noop
      }, set: () => true })
    }
    win.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 360, height: 400, right: 360, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
    win.onerror = (msg, src, line, col) => { errors.push(`${msg} @${line}:${col}`); return true }
    win.addEventListener('error', (e) => { errors.push(String(e.message)) })
  },
})

setTimeout(() => {
  const doc = dom.window.document
  const scalp = doc.querySelector('.by-scalp')
  const txt = scalp ? scalp.textContent.replace(/\s+/g, ' ').trim() : 'NO SCALP PANEL'
  const sigs = [...doc.querySelectorAll('.by-sig')]
  const stats = doc.querySelector('.by-scalp-stats') ? doc.querySelector('.by-scalp-stats').textContent.replace(/\s+/g, ' ').trim() : '-'
  const sess = [...doc.querySelectorAll('.by-sess-col')].map((el) => el.textContent.replace(/\s+/g, ' ').trim())
  console.log('scalp header:', txt.slice(0, 120))
  console.log('stats:', stats)
  console.log('sessions:', JSON.stringify(sess))
  console.log('signal rows:', sigs.length)
  if (sigs[0]) console.log('row0:', sigs[0].textContent.replace(/\s+/g, ' ').trim())
  console.log('runtime errors:', errors.length ? errors.slice(0, 5) : 'NONE')
  const ok = !!scalp && sigs.length === 4 && txt.includes('4 signal hari ini') &&
    txt.includes('rujukan 15m') && stats.includes('92') && sess.length === 4 &&
    txt.includes('3,541.70') && errors.length === 0
  console.log('SCALP PANEL:', ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
}, 2500)
