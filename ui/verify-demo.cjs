// Verify demo-api.html: fetch berfungsi, carta SVG dirender, carian berfungsi.
const fs = require('node:fs')
const { JSDOM } = require('jsdom')

const html = fs.readFileSync('../demo-api.html', 'utf8')

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost:8097/demo-api.html',
  resources: 'usable',
  beforeParse(win) {
    win.fetch = (u, o) => fetch(u, o)
    win.requestAnimationFrame = (cb) => setTimeout(cb, 16)
    win.cancelAnimationFrame = clearTimeout
    win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
  },
})

const $ = (id) => dom.window.document.getElementById(id)

setTimeout(async () => {
  console.log('harga    :', $('px').textContent)
  console.log('perubahan:', $('chg').textContent)
  console.log('status   :', $('st').textContent)
  console.log('ohlc     :', $('ohlc').textContent.slice(0, 80))
  const rects = dom.window.document.querySelectorAll('#chart rect').length
  const lines = dom.window.document.querySelectorAll('#chart line').length
  console.log('candle SVG  : rect=' + rects + ' line=' + lines)

  // carian
  $('go').dispatchEvent(new dom.window.Event('click'))
  await new Promise(r => setTimeout(r, 3000))
  console.log('carian   :', $('out').textContent.slice(0, 160).replace(/\n/g, ' | '))

  const ok = $('px').textContent !== '—' && rects > 10
  console.log(ok ? 'DEMO OK' : 'DEMO GAGAL')
  process.exit(ok ? 0 : 1)
}, 6000)
