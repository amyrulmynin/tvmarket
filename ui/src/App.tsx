import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries } from 'lightweight-charts'
import type { UTCTimestamp, ISeriesApi } from 'lightweight-charts'
import SegmentedControl, { type Segment } from './arc/segmented-control/segmented-control'
import { AnimatedCounter } from './arc/animated-counter/animated-counter'
import { Badge } from './arc/badge/badge'

// Senarai host API. #1 = tunnel HTTPS (sama untuk SEMUA client: web + APK).
// Dicuba mengikut turutan; kalau satu gagal, cuba seterusnya.
// Nota: Cloudflare buffer SSE body, jadi kita guna polling pendek (2s) untuk live.
const API_HOSTS = [
  'https://maine-roulette-throws-qty.trycloudflare.com',
  'http://43.134.97.197:8080',
]

const SYMBOL = 'OANDA:XAUUSD'

const INTERVALS: Segment[] = [
  { label: '1m', value: '1' },
  { label: '5m', value: '5' },
  { label: '15m', value: '15' },
  { label: '1H', value: '60' },
  { label: '4H', value: '240' },
  { label: '1D', value: '1D' },
]

type Candle = {
  time: UTCTimestamp; open: number; high: number; low: number;
  close: number; volume?: number
}
type Quote = {
  symbol: string; name?: string; price: number; changePercent?: number;
  volume?: number; high?: number; low?: number; open?: number; source?: string
}

const nf = (v: number, d = 2) =>
  v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

const toCandles = (raw: any[]): Candle[] =>
  (raw || [])
    .map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    }))
    .sort((a, b) => (a.time as number) - (b.time as number))

function useLive(interval: string, bars: number) {
  const [candles, setCandles] = useState<Candle[]>([])
  const [quote, setQuote] = useState<Quote | null>(null)
  const [status, setStatus] = useState('menyambung...')
  const [live, setLive] = useState(false)

  useEffect(() => {
    let closed = false
    let hostIdx = 0
    let failCount = 0
    let timer: number | undefined

    const poll = async () => {
      if (closed) return
      const host = API_HOSTS[hostIdx % API_HOSTS.length]
      const url = `${host}/api/live?symbol=${encodeURIComponent(SYMBOL)}`
        + `&interval=${interval}&bars=${bars}`

      try {
        const r = await fetch(url, { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const d = await r.json()
        if (closed) return

        const arr = toCandles(d.candles)
        if (arr.length) setCandles(arr)
        if (d.quote) setQuote(d.quote)
        setLive(true)
        failCount = 0
        setStatus(`live · ${arr.length} candle · ${interval}`)
        timer = window.setTimeout(poll, 2000)
      } catch {
        if (closed) return
        setLive(false)
        failCount++
        // Selepas 3 kali gagal, tukar host
        if (failCount >= 3) { hostIdx++; failCount = 0 }
        setStatus('sambung semula...')
        timer = window.setTimeout(poll, 3000)
      }
    }

    poll()
    return () => { closed = true; if (timer) clearTimeout(timer) }
  }, [interval, bars])

  return { candles, quote, status, live }
}

export default function App() {
  const [interval, setIntervalVal] = useState('1')
  const [bars, setBars] = useState(120)
  const { candles, quote, status, live } = useLive(interval, bars)

  const chartEl = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  const lastPrice = quote?.price ?? (candles.length ? candles[candles.length - 1].close : 0)
  const prevPrice = useRef(lastPrice)
  const [flash, setFlash] = useState<'up' | 'down' | ''>('')

  useEffect(() => {
    const old = prevPrice.current
    if (lastPrice !== old) {
      setFlash(lastPrice > old ? 'up' : 'down')
      prevPrice.current = lastPrice
      const t = setTimeout(() => setFlash(''), 320)
      return () => clearTimeout(t)
    }
  }, [lastPrice])

  useEffect(() => {
    if (!chartEl.current) return
    const chart = createChart(chartEl.current, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: '#8a93a6',
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(35, 40, 51, 0.6)' },
        horzLines: { color: 'rgba(35, 40, 51, 0.6)' },
      },
      rightPriceScale: { borderColor: 'rgba(35, 40, 51, 0.8)' },
      timeScale: { borderColor: 'rgba(35, 40, 51, 0.8)', timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: 'rgba(138, 147, 166, 0.35)', labelBackgroundColor: '#232833' },
        horzLine: { color: 'rgba(138, 147, 166, 0.35)', labelBackgroundColor: '#232833' },
      },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    })
    chartRef.current = chart
    seriesRef.current = series
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null }
  }, [])

  const fittedRef = useRef(false)

  useEffect(() => {
    if (!seriesRef.current || !candles.length) return
    seriesRef.current.setData(candles)
    // Fit hanya sekali bila data pertama sampai — jangan reset zoom setiap poll 2s
    if (!fittedRef.current) {
      chartRef.current?.timeScale().fitContent()
      fittedRef.current = true
    }
  }, [candles])

  const change = quote?.changePercent ?? 0
  const up = change >= 0

  return (
    <div className="app">
      <div className="grain" aria-hidden />

      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">X</div>
          <span className="brand-name">TV MARKET</span>
        </div>
        <span className={`live-dot ${live ? '' : 'dead'}`} title={live ? 'live' : 'offline'} />
      </header>

      <section className="quote">
        <div className="symbol-row">
          <span className="symbol">{SYMBOL}</span>
          {quote?.name && (
            <span className="symbol" style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
              {quote.name}
            </span>
          )}
        </div>
        <div className="price-row">
          <div className={`price ${flash ? `flash-${flash}` : ''}`}>
            <AnimatedCounter value={lastPrice} decimals={2} />
          </div>
          <Badge tone={up ? 'success' : 'danger'} size="md" pill dot>
            {up ? '+' : ''}{change.toFixed(2)}%
          </Badge>
        </div>
        <div className="meta">
          {quote?.high != null && <span>Tinggi <b>{nf(quote.high)}</b></span>}
          {quote?.low != null && <span>Rendah <b>{nf(quote.low)}</b></span>}
          {quote?.open != null && <span>Buka <b>{nf(quote.open)}</b></span>}
          {quote?.volume != null && <span>Vol <b>{quote.volume.toLocaleString('en-US')}</b></span>}
        </div>
      </section>

      <main className="chart-wrap">
        <div className="chart" ref={chartEl} />
      </main>

      <footer className="controls">
        <SegmentedControl
          options={INTERVALS}
          value={interval}
          onValueChange={(v: string) => {
            fittedRef.current = false
            setIntervalVal(v)
            setBars(150)
          }}
        />
        <div className="statusline">{status}</div>
      </footer>
    </div>
  )
}
