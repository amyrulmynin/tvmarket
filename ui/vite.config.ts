import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// Build untuk WebView Android dari file:// — module script DITOLAK oleh CORS
// (origin null), jadi selepas build kita inline semua CSS + JS ke dalam
// index.html sebagai classic script, bukan `<script type="module">`.
function inlineForWebView() {
  return {
    name: 'inline-for-webview',
    enforce: 'post' as const,
    closeBundle() {
      const outDir = path.resolve(__dirname, '../app/src/main/assets/web')
      const htmlPath = path.join(outDir, 'index.html')
      if (!fs.existsSync(htmlPath)) return

      let html = fs.readFileSync(htmlPath, 'utf8')

      // inline CSS
      html = html.replace(
        /<link[^>]+rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g,
        (_m, file) => {
          const p = path.join(outDir, file)
          if (!fs.existsSync(p)) return ''
          return `<style>\n${fs.readFileSync(p, 'utf8')}\n</style>`
        },
      )

      // inline JS sebagai classic script (buang type="module" + crossorigin)
      html = html.replace(
        /<script[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g,
        (_m, file) => {
          const p = path.join(outDir, file)
          if (!fs.existsSync(p)) return ''
          const code = fs.readFileSync(p, 'utf8')
          // Simpan sebagai tag tersembunyi supaya boleh dipindah ke akhir body.
          return `<!--APPJS--><script>\n${code}\n</script><!--/APPJS-->`
        },
      )

      // Pindahkan script ke hujung <body> — React createRoot perlukan #root
      // sudah wujud dalam DOM, kalau script jalan dalam <head> ia gagal
      // dengan "Target container is not a DOM element" (React error #299).
      //
      // DUA jebakan:
      //  1. replace(str) meng-interpret $& / $' / $1 dalam replacement —
      //     minified JS penuh dengan $, ia akan melipatgandakan kod (28MB!).
      //     Guna function sebagai ganti.
      //  2. `</script>` dalam string JS memotong <script> awal dalam HTML.
      //     Escape `</script` hanya dalam KANDUNGAN JS (bukan closing tag
      //     asal), jadi buat sebelum bungkus <script>...</script>.
      const jsMatch = html.match(/<!--APPJS-->([\s\S]*?)<!--\/APPJS-->/)
      if (jsMatch) {
        html = html.replace(/<!--APPJS-->[\s\S]*?<!--\/APPJS-->/, '')
        const raw = jsMatch[1]
          .replace(/^<script>\s*/i, '')
          .replace(/\s*<\/script>\s*$/i, '')
        const safeJs = raw.replace(/<\/script/gi, '<\\/script')
        html = html.replace('</body>', () => `<script>\n${safeJs}\n</script>\n</body>`)
      }

      // buang baki favicon yang tak diperlukan
      html = html.replace(/<link[^>]+rel="icon"[^>]*>/g, '')
      html = html.replace('<title>ui</title>', '<title>TV Market</title>')

      fs.writeFileSync(htmlPath, html)
      console.log(`[inline] index.html => ${(html.length / 1024).toFixed(0)} KB (single file)`)

      // buang fail luaran supaya APK tak bawa duplikat
      for (const f of fs.readdirSync(outDir)) {
        if (f !== 'index.html') fs.rmSync(path.join(outDir, f), { recursive: true, force: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), inlineForWebView()],
  base: './',
  build: {
    outDir: '../app/src/main/assets/web',
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    // target ES2015 — WebView peranti lama (Chrome <80) tak faham optional
    // chaining (?.) / nullish coalescing (??). Kalau syntax tak di-parse,
    // SELURUH script gagal dan skrin jadi kosong (blank) tanpa error jelas.
    target: 'es2015',
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        manualChunks: undefined,
        entryFileNames: 'app.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
})
