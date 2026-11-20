# TV Market

Live XAUUSD chart + REST API client demo + Android WebView app source.

## Deploy

Root `index.html` ialah demo statik (fetch API terus, tanpa build). Deploy saja sebagai
static site di Vercel / Netlify / GitHub Pages — `vercel.json` sudah disediakan.

## API

Base URL: `https://maine-roulette-throws-qty.trycloudflare.com`

| Endpoint | Parameter | Pulangan |
|---|---|---|
| `/api/live` | `symbol, interval, bars` | quote + candles (disyorkan) |
| `/api/quote` | `symbol` | harga + changePercent |
| `/api/candles` | `symbol, interval, bars` | candles |
| `/api/search` | `q` | carian simbol |
| `/api/health` | — | status server |

Tak perlu API key. CORS dibuka (`*`).

```js
const r = await fetch(`${API}/api/live?symbol=OANDA:XAUUSD&interval=1&bars=120`, { cache: 'no-store' });
const d = await r.json();
```

## Jalankan API sendiri

```bash
npm run api        # http://localhost:8081
```

## Build UI / APK

```bash
cd ui && npm install && npm run build
bash build-apk.sh
```

## Struktur

- `index.html` — demo client (deploy ke Vercel)
- `api/server-live.js` — REST API server (Node, zero-dependency)
- `ui/` — sumber React + Vite untuk APK
- `android-src/` — sumber Android WebView
- `build-apk.sh` — script bina APK tanpa Gradle
