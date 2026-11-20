// Sahkan index.html APK benar-benar mount React (skrin tak kosong).
const fs = require('node:fs')
const { JSDOM } = require('jsdom')

const html = fs.readFileSync('../app/src/main/assets/web/index.html', 'utf8')

const errors = []
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'file:///android_asset/web/index.html',
  beforeParse(win) {
    // simulasi WebView Android
    win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
    win.requestAnimationFrame = (cb) => setTimeout(cb, 16)
    win.cancelAnimationFrame = clearTimeout
    win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
    win.fetch = () => Promise.reject(new Error('offline'))
    // jsdom tiada canvas engine — lightweight-charts perlu getContext('2d').
    // Stub dengan Proxy yang telan semua panggilan (cukup untuk sahkan mount;
    // peranti sebenar ada canvas sebenar).
    win.HTMLCanvasElement.prototype.getContext = function () {
      const noop = () => {}
      return new Proxy({}, {
        get: (t, p) => {
          if (p === 'measureText') return () => ({ width: 10 })
          if (p === 'createLinearGradient' || p === 'createRadialGradient') {
            return () => ({ addColorStop: noop })
          }
          return noop
        },
        set: () => true,
      })
    }
    win.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 0, width: 360, height: 400, right: 360, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }
    }
    win.onerror = (msg, src, line, col, err) => { errors.push(`${msg} @${line}:${col}`); return true }
    win.addEventListener('error', (e) => { errors.push(String(e.message)) })
  },
})

setTimeout(() => {
  const doc = dom.window.document
  const root = doc.getElementById('root')
  console.log('root children:', root ? root.childElementCount : 'NO ROOT')
  console.log('root innerHTML length:', root ? root.innerHTML.length : 0)
  console.log('body text (200):', JSON.stringify((doc.body.textContent || '').slice(0, 200)))
  console.log('runtime errors:', errors.length ? errors.slice(0, 5) : 'NONE')
  process.exit(root && root.childElementCount > 0 ? 0 : 1)
}, 3000)
