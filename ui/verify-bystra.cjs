// Sahkan panel Bystra memaparkan entry/SL/TP/confidence bila ada data.
const fs = require('node:fs')
const { JSDOM } = require('jsdom')

const html = fs.readFileSync('../app/src/main/assets/web/index.html', 'utf8')

const MOCK_BYSTRA = {
  ok: true, price: 3553.42, atr: 5.82, trend: 'down',
  direction: { type: 'DMD2', bias: 'bull', zone: { top: 3522.66, bottom: 3522.65 } },
  summary: 'Direction DMD2 naik',
  counts: { swings: 40, dmd: 6, bases: 35 },
  snr: [
    { price: 3556.005, role: 'resistance', touches: 3, grade: 'weak', distancePct: 0.055, side: 'above' },
    { price: 3542.465, role: 'support', touches: 1, grade: 'strong', distancePct: -0.32, side: 'below' },
  ],
  engulfing: { bias: 'bull', i: 148 },
  setups: [
    { name: 'SNRC1', bias: 'bull', kind: 'continuation', risk: 'low', time: 1795153500, i: 148, ck: 'CK2', conf: 72, agreesDir: true },
    { name: 'QMC', bias: 'bull', kind: 'continuation', risk: 'low', time: 1795153400, i: 146, ck: null, conf: 58, agreesDir: true },
  ],
  plan: {
    bias: 'bull', setup: 'SNRC1', ck: 'CK2',
    entry: 3553.42, sl: 3538.87, tp1: 3567.97, tp2: 3582.52,
    riskPips: 14.55, rr1: 1, rr2: 2, confidence: 72, atr: 5.82,
  },
  htf: { interval: '5', trend: 'down' },
}

const errors = []
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'file:///android_asset/web/index.html',
  beforeParse(win) {
    win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
    win.requestAnimationFrame = (cb) => setTimeout(cb, 16)
    win.cancelAnimationFrame = clearTimeout
    win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
    win.fetch = (url) => {
      if (String(url).includes('/api/bystra')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_BYSTRA) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ candles: [], quote: null }) })
    }
    win.HTMLCanvasElement.prototype.getContext = function () {
      const noop = () => {}
      return new Proxy({}, {
        get: (t, p) => {
          if (p === 'measureText') return () => ({ width: 10 })
          if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop })
          return noop
        },
        set: () => true,
      })
    }
    win.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 0, width: 360, height: 400, right: 360, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }
    }
    win.onerror = (msg, src, line, col) => { errors.push(`${msg} @${line}:${col}`); return true }
    win.addEventListener('error', (e) => { errors.push(String(e.message)) })
  },
})

setTimeout(() => {
  const doc = dom.window.document
  const panel = doc.querySelector('.by-panel')
  const txt = panel ? panel.textContent.replace(/\s+/g, ' ').trim() : 'NO PANEL'
  const levels = [...doc.querySelectorAll('.by-lv')].map((el) => el.textContent.replace(/\s+/g, ' ').trim())
  const conf = doc.querySelector('.by-conf') ? doc.querySelector('.by-conf').textContent.replace(/\s+/g, ' ').trim() : '-'
  console.log('panel text:', txt.slice(0, 260))
  console.log('levels:', JSON.stringify(levels))
  console.log('confidence:', conf)
  console.log('runtime errors:', errors.length ? errors.slice(0, 5) : 'NONE')
  const okPanel = levels.length === 4 && conf.includes('72%') && txt.includes('BUY') && txt.includes('SNRC1')
  console.log('BYSTRA PANEL:', okPanel ? 'PASS' : 'FAIL')
  process.exit(okPanel ? 0 : 1)
}, 2500)
