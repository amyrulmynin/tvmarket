'use strict';
/**
 * bystra.js — Engine penunjuk kaedah Bystra (Nora) untuk TV Market.
 *
 * Sumber konsep (nota peribadi, tidak disertakan dalam repo awam):
 *   - PoB English Full Version   : QMR, QMC, QML, QM2P, QMM, SNRC1/2/3, BSD, MEF, CLAB/CK1-3
 *   - Personal Coaching (DMD1/2) : Double Marubozu Direction, SISD, BSD
 *   - Hybrid + Setup             : glosari BUE/BEE, HTF/LTF, LTF setup -> HTF confirm
 *   - Irel homework              : peraturan ketat setiap setup (Low/High Risk)
 *   - Najmi SNR                  : 5 SOP (Zone, Rejection, Confirmation, Setup, Entry)
 *
 * Prinsip: Direction di HTF, Setup di LTF, Confirmation = engulfing / confluence.
 * Semua fungsi tulen (pure) — input array candle, output objek. Tiada dependency.
 */

// ---------------------------------------------------------------- util
const body = (c) => Math.abs(c.close - c.open);
const range = (c) => Math.max(c.high - c.low, 1e-9);
const upperWick = (c) => c.high - Math.max(c.open, c.close);
const lowerWick = (c) => Math.min(c.open, c.close) - c.low;
const isBull = (c) => c.close > c.open;
const isBear = (c) => c.close < c.open;

/** Marubozu: badan dominan, sumbu kecil. */
function isMarubozu(c, minBody = 0.6, maxWick = 0.3) {
  const r = range(c);
  return body(c) / r >= minBody && (upperWick(c) + lowerWick(c)) / r <= maxWick;
}

/** Engulfing: badan candle B menelan badan candle A. */
function engulf(a, b) {
  const bull = isBear(a) && isBull(b) && b.open <= a.close && b.close >= a.open && body(b) > body(a);
  const bear = isBull(a) && isBear(b) && b.open >= a.close && b.close <= a.open && body(b) > body(a);
  return bull ? 'bull' : bear ? 'bear' : null;
}

/** Base candle: badan kecil (doji/spinning) — komponen tengah RBR/DBD. */
function isBase(a, b, c) {
  return body(b) / range(b) < 0.45 && body(b) < body(a) * 0.8 && body(b) < body(c) * 0.8;
}

// ---------------------------------------------------------------- swings
/** Fraktal swing high/low dengan lookback k. */
function findSwings(candles, k = 2) {
  const out = [];
  for (let i = k; i < candles.length - k; i++) {
    let hi = true, lo = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) hi = false;
      if (candles[j].low <= candles[i].low) lo = false;
    }
    if (hi) out.push({ i, price: candles[i].high, type: 'H', time: candles[i].time });
    if (lo) out.push({ i, price: candles[i].low, type: 'L', time: candles[i].time });
  }
  out.sort((a, b) => a.i - b.i);
  return out;
}

/** Trend dari 6 swing terakhir: HH/HL = up, LH/LL = down. */
function trendOf(swings) {
  const h = swings.filter((s) => s.type === 'H').slice(-3);
  const l = swings.filter((s) => s.type === 'L').slice(-3);
  if (h.length < 2 || l.length < 2) return 'range';
  const hh = h[h.length - 1].price > h[h.length - 2].price;
  const hl = l[l.length - 1].price > l[l.length - 2].price;
  const lh = h[h.length - 1].price < h[h.length - 2].price;
  const ll = l[l.length - 1].price < l[l.length - 2].price;
  if (hh && hl) return 'up';
  if (lh && ll) return 'down';
  return 'range';
}

// ---------------------------------------------------------------- DMD (Direction)
/**
 * DMD1/DMD2 — Double Marubozu Direction.
 * Dua marubozu berturut (bukan bersebelahan): open candle-2 = close candle-1.
 * DMD1: satu arah sahaja (HH sahaja atau LL sahaja).
 * DMD2: lebih kuat — menembusi swing sebelumnya (structure break).
 * Zon = bahagian tengah dua candle (supply/demand) — tempat QMR/MEF biasanya lahir.
 */
function detectDMD(candles, swings) {
  const hits = [];
  for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1], b = candles[i];
    if (!isMarubozu(a, 0.55, 0.35) || !isMarubozu(b, 0.55, 0.35)) continue;
    const sameDir = (isBull(a) && isBull(b)) || (isBear(a) && isBear(b));
    if (!sameDir) continue;
    // mesti bertindan menegak (open-2 dekat dengan close-1), bukan side-by-side
    const stackTol = range(b) * 0.6;
    if (Math.abs(b.open - a.close) > stackTol) continue;

    const bull = isBull(a);
    // kawasan tengah = antara dua badan (zon)
    const zTop = bull ? Math.max(a.close, b.open) : Math.max(a.open, b.close);
    const zBot = bull ? Math.min(a.close, b.open) : Math.min(a.open, b.close);

    // DMD2 jika menembusi swing bertentangan terdekat sebelum corak
    let broke = false;
    const prior = swings.filter((s) => s.i < i - 1).slice(-4);
    for (const s of prior) {
      if (bull && s.type === 'H' && b.close > s.price) broke = true;
      if (!bull && s.type === 'L' && b.close < s.price) broke = true;
    }

    hits.push({
      type: broke ? 'DMD2' : 'DMD1',
      bias: bull ? 'bull' : 'bear',
      i, time: b.time,
      zone: { top: Math.max(zTop, zBot), bottom: Math.min(zTop, zBot) },
      strength: broke ? 2 : 1,
    });
  }
  return hits;
}

// ---------------------------------------------------------------- Entry point (RBR/DBD/RBD/DBR)
/**
 * Empat jenis entry point Bystra — semuanya variasi engulfing berasaskan "base".
 *   RBR (Rally-Base-Rally)   = continuation buy
 *   DBD (Drop-Base-Drop)     = continuation sell
 *   RBD (Rally-Base-Drop)    = reversal sell
 *   DBR (Drop-Base-Rally)    = reversal buy
 */
function detectBases(candles) {
  const out = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2], b = candles[i - 1], c = candles[i];
    if (!isBase(a, b, c)) continue;
    const aUp = isBull(a), cUp = isBull(c);
    let type = null;
    if (aUp && cUp) type = 'RBR';
    else if (!aUp && !cUp) type = 'DBD';
    else if (aUp && !cUp) type = 'RBD';
    else type = 'DBR';
    const continuation = type === 'RBR' || type === 'DBD';
    out.push({
      type,
      bias: cUp ? 'bull' : 'bear',
      kind: continuation ? 'continuation' : 'reversal',
      i, time: c.time,
      entry: c.close,
      zone: { top: Math.max(a.close, b.high, c.open), bottom: Math.min(a.close, b.low, c.open) },
    });
  }
  return out;
}

// ---------------------------------------------------------------- QM family
/**
 * QMR — Quasimodo Reversal (High Risk, reversal).
 * Corak sell: H1 (left shoulder) -> L1 -> H2 (head, HH) -> break L1 -> retest H1.
 * Corak buy  : L1 -> H1 -> L2 (head, LL) -> break H1 -> retest L1.
 */
function detectQM(candles, swings) {
  const out = [];
  for (let s = 4; s < swings.length; s++) {
    const w = swings.slice(s - 4, s + 1);
    const types = w.map((x) => x.type).join('');
    if (types === 'HLHLH') {
      const [h1, l1, h2, l2, h3] = w;
      if (h2.price > h1.price && l2.price > l1.price) {
        // QM sell lengkap jika harga kemudian menembusi l1 (neckline)
        const after = candles.slice(l2.i + 1);
        const broke = after.some((c) => c.close < l1.price);
        const retest = after.some((c) => c.high >= h1.price - range(c) && c.close < h1.price);
        out.push({
          name: 'QMR', bias: 'bear', i: l2.i, time: l2.time,
          kind: 'reversal', risk: 'high',
          neckline: l1.price, level: h1.price, head: h2.price,
          complete: broke, retested: retest,
        });
      }
    }
    if (types === 'LHLHL') {
      const [l1, h1, l2, h2, l3] = w;
      if (l2.price < l1.price && h2.price < h1.price) {
        const after = candles.slice(h2.i + 1);
        const broke = after.some((c) => c.close > h1.price);
        const retest = after.some((c) => c.low <= l1.price + range(c) && c.close > l1.price);
        out.push({
          name: 'QMR', bias: 'bull', i: h2.i, time: h2.time,
          kind: 'reversal', risk: 'high',
          neckline: h1.price, level: l1.price, head: l2.price,
          complete: broke, retested: retest,
        });
      }
    }
  }
  return out;
}

/**
 * QMC — QM Continuation (Low Risk, selepas reversal, sentuhan TL ke-3).
 * Dikesan: dua swing low menaik + sentuhan ketiga pada garis sambungan.
 */
function detectQMC(candles, swings) {
  const out = [];
  const lows = swings.filter((s) => s.type === 'L');
  const highs = swings.filter((s) => s.type === 'H');

  const lineAt = (p1, p2, x) => p1.price + ((p2.price - p1.price) / (p2.i - p1.i)) * (x - p2.i);

  for (let k = 0; k + 2 < lows.length; k++) {
    const a = lows[k], b = lows[k + 1];
    if (b.price <= a.price) continue; // perlu HL (uptrend)
    let touch = null;
    for (let i = b.i + 1; i < candles.length; i++) {
      const lvl = lineAt(a, b, i);
      if (Math.abs(candles[i].low - lvl) < range(candles[i]) * 0.5) { touch = i; break; }
    }
    if (touch != null) out.push({ name: 'QMC', bias: 'bull', i: touch, time: candles[touch].time, kind: 'continuation', risk: 'low', level: lineAt(a, b, touch) });
  }

  for (let k = 0; k + 2 < highs.length; k++) {
    const a = highs[k], b = highs[k + 1];
    if (b.price >= a.price) continue; // perlu LH (downtrend)
    let touch = null;
    for (let i = b.i + 1; i < candles.length; i++) {
      const lvl = lineAt(a, b, i);
      if (Math.abs(candles[i].high - lvl) < range(candles[i]) * 0.5) { touch = i; break; }
    }
    if (touch != null) out.push({ name: 'QMC', bias: 'bear', i: touch, time: candles[touch].time, kind: 'continuation', risk: 'low', level: lineAt(a, b, touch) });
  }
  return out;
}

/**
 * Blindspot (BSD) — tiada entry point; jurang harga yang diisi kemudian.
 * Bullish BS: high(c1) < low(c3)  → jurang di bawah, harga kembali isi.
 * Bearish BS: low(c1)  > high(c3) → jurang di atas.
 * Perlu jurang bermakna (>= 0.15 ATR) — elak false positive.
 */
function detectBlindspot(candles, atrPct = 0.0015) {
  const out = [];
  const last = candles[candles.length - 1].close;
  const minGap = last * atrPct;
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2], c = candles[i];
    if (a.high < c.low && (c.low - a.high) >= minGap) {
      const filled = candles.slice(i + 1).some((x) => x.low <= a.high);
      out.push({ name: 'BSD', bias: 'bull', i, time: c.time, kind: 'reversal', risk: 'high', gap: { top: c.low, bottom: a.high }, filled });
    } else if (a.low > c.high && (a.low - c.high) >= minGap) {
      const filled = candles.slice(i + 1).some((x) => x.high >= a.low);
      out.push({ name: 'BSD', bias: 'bear', i, time: c.time, kind: 'reversal', risk: 'high', gap: { top: a.low, bottom: c.high }, filled });
    }
  }
  return out;
}

/**
 * MEF/Manipulation — sapuan stop-loss / liquidity sweep (Najmi: reversal, higher risk dari QMR).
 * Wick menembusi swing sebelum ini lalu close kembali di dalam.
 * Perlu penembusan >= 0.1% dan close balik dengan margin.
 */
function detectMEF(candles, swings, atrPct = 0.001) {
  const out = [];
  const last = candles[candles.length - 1].close;
  const minSweep = last * atrPct;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prior = swings.filter((s) => s.i < i - 1).slice(-3);
    for (const s of prior) {
      if (s.type === 'H' && (c.high - s.price) >= minSweep && c.close < s.price) {
        out.push({ name: 'MEF', bias: 'bear', i, time: c.time, kind: 'reversal', risk: 'high', swept: s.price });
        break;
      }
      if (s.type === 'L' && (s.price - c.low) >= minSweep && c.close > s.price) {
        out.push({ name: 'MEF', bias: 'bull', i, time: c.time, kind: 'reversal', risk: 'high', swept: s.price });
        break;
      }
    }
  }
  return out;
}

/**
 * Najmi 5SOP — SOP 2: Rejection.
 * Harga masuk zon SNR lalu "ditolak" (wick menembusi tapi close kembali luar zon).
 * Support: low masuk zon bawah, close balik ATAS zon. Resistance: high masuk zon, close BALIK BAWAH zon.
 */
function detectRejection(candles, levels, tolPct = 0.0012) {
  const out = [];
  const last = candles[candles.length - 1].close;
  const tol = last * tolPct;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    for (const l of levels) {
      const near = Math.abs(c.low - l.price) <= tol * 2 || Math.abs(c.high - l.price) <= tol * 2
        || (c.low <= l.price && c.high >= l.price);
      if (!near) continue;
      if (l.type === 'L' && c.low <= l.price && c.close > l.price && lowerWick(c) > body(c) * 0.5) {
        out.push({ i, time: c.time, level: l.price, bias: 'bull', side: 'support' });
        break;
      }
      if (l.type === 'H' && c.high >= l.price && c.close < l.price && upperWick(c) > body(c) * 0.5) {
        out.push({ i, time: c.time, level: l.price, bias: 'bear', side: 'resistance' });
        break;
      }
    }
  }
  return out;
}

/**
 * Najmi — Engulfing 3 Type (SOP 3: Confirmation).
 * Type1: 1 candle dimakan 1 candle. Type2: 1 dimakan 2. Type3: 1 dimakan 3 ("blank candle").
 * Semua berdasarkan badan, bukan sumbu.
 */
function engulfType(candles, i) {
  const c = candles[i];
  // Type 1: candle i menelan candle i-1
  if (i >= 1) {
    const a = candles[i - 1];
    if (isBull(c) && isBear(a) && c.open <= a.close && c.close >= a.open && body(c) > body(a)) return { type: 1, bias: 'bull' };
    if (isBear(c) && isBull(a) && c.open >= a.close && c.close <= a.open && body(c) > body(a)) return { type: 1, bias: 'bear' };
  }
  // Type 2: candle i menelan 2 candle sebelumnya
  if (i >= 2) {
    const a = candles[i - 2], b = candles[i - 1];
    const lo = Math.min(a.open, a.close, b.open, b.close);
    const hi = Math.max(a.open, a.close, b.open, b.close);
    const sumBody = body(a) + body(b);
    if (isBull(c) && c.open <= lo && c.close >= hi && body(c) > sumBody * 0.8) return { type: 2, bias: 'bull' };
    if (isBear(c) && c.open >= hi && c.close <= lo && body(c) > sumBody * 0.8) return { type: 2, bias: 'bear' };
  }
  // Type 3: candle i menelan 3 candle sebelumnya
  if (i >= 3) {
    const a = candles[i - 3], b = candles[i - 2], d = candles[i - 1];
    const lo = Math.min(a.open, a.close, b.open, b.close, d.open, d.close);
    const hi = Math.max(a.open, a.close, b.open, b.close, d.open, d.close);
    const sumBody = body(a) + body(b) + body(d);
    if (isBull(c) && c.open <= lo && c.close >= hi && body(c) > sumBody * 0.8) return { type: 3, bias: 'bull' };
    if (isBear(c) && c.open >= hi && c.close <= lo && body(c) > sumBody * 0.8) return { type: 3, bias: 'bear' };
  }
  return null;
}

// ---------------------------------------------------------------- SNR
/**
 * 2nd Movement (Najmi) — validasi zon SNR.
 * "The zone have a 2nd movement" = harga sentuh zon, pergi jauh, datang balik sentuh lagi.
 * Zon tanpa 2nd movement = zon hujung trend = BERBAHAYA (invalid).
 * Support sah: 2nd movement bermula dari bawah/floor. Resistance sah: dari atas/roof.
 */
function detect2ndMovement(candles, level, type, minSepPct = 0.004) {
  const tol = level * 0.0015;
  const touches = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const hit = type === 'L'
      ? Math.abs(c.low - level) <= tol || c.low <= level + tol && c.high >= level - tol
      : Math.abs(c.high - level) <= tol || c.high >= level - tol && c.low <= level + tol;
    if (hit) touches.push(i);
  }
  if (touches.length < 2) return { has2nd: false, touches: touches.length, gapPct: 0 };
  // cari dua sentuhan berturutan yang dipisahkan pergerakan bermakna
  for (let k = 1; k < touches.length; k++) {
    const a = touches[k - 1], b = touches[k];
    const between = candles.slice(a + 1, b);
    if (!between.length) continue;
    const extreme = type === 'L'
      ? Math.max(...between.map((x) => x.high))
      : Math.min(...between.map((x) => x.low));
    const gapPct = Math.abs(extreme - level) / level * 100;
    if (gapPct >= minSepPct * 100) return { has2nd: true, touches: touches.length, gapPct: +gapPct.toFixed(2) };
  }
  return { has2nd: false, touches: touches.length, gapPct: 0 };
}

/**
 * Level SNR + kekuatan.
 * Najmi: "the more touched, the weaker that SNR".
 * A/V capital letter (Irel) = level belum disentuh = kuat.
 * Di atas harga = Resistance (sell zone). Di bawah = Support (buy zone).
 */
function findSNR(candles, swings, tolPct = 0.0012) {
  const last = candles[candles.length - 1].close;
  const tol = last * tolPct;
  const raw = swings.map((s) => ({ price: s.price, type: s.type, i: s.i }));
  const levels = [];

  for (const r of raw) {
    let lv = levels.find((x) => Math.abs(x.price - r.price) <= tol && x.type === r.type);
    if (!lv) { lv = { price: r.price, type: r.type, touches: 0, first: r.i, last: r.i }; levels.push(lv); }
    lv.touches++;
    lv.last = Math.max(lv.last, r.i);
    lv.price = (lv.price + r.price) / 2;
  }

  return levels
    .map((l) => {
      const side = l.price > last ? 'above' : 'below';
      // Di atas harga = Resistance (tempat sell). Di bawah = Support (tempat buy).
      // Hanya swing H kira sebagai resistance, swing L kira sebagai support.
      // Kekuatan: 1 sentuhan = strong (A/V), 2 = medium, 3+ = weak (banyak disentuh).
      const m2 = detect2ndMovement(candles, l.price, l.type);
      // Najmi: zon tanpa 2nd movement = zon hujung trend = INVALID/BERBAHAYA.
      // Zon valid + belum disentuh banyak = terbaik.
      let grade = l.touches === 1 ? 'strong' : l.touches === 2 ? 'medium' : 'weak';
      if (!m2.has2nd) grade = 'invalid';
      else if (m2.touches >= 4) grade = 'weak';
      return {
        price: l.price,
        role: l.type === 'H' ? 'resistance' : 'support',
        touches: l.touches,
        grade,
        secondMovement: m2.has2nd,
        gapPct: m2.gapPct,
        distancePct: ((l.price - last) / last) * 100,
        side,
      };
    })
    .filter((l) => (l.role === 'resistance') === (l.side === 'above'))
    .filter((l) => l.grade !== 'invalid')
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));
}

// ---------------------------------------------------------------- confluence
/**
 * CK1/CK2/CK3 — tahap confluence (CLAB).
 *   CK1 = SNR kuat + trendline
 *   CK2 = double confluence (2 SnR / SnR + TL selari)
 *   CK3 = CK2 + engulfing padu + pengesahan HTF
 */
function gradeConfluence({ snrNear, trendline, engulfing, htfConfirm }) {
  let score = 0, ck = null;
  if (snrNear) score++;
  if (trendline) score++;
  if (engulfing) score++;
  if (htfConfirm) score++;
  if (score >= 4) ck = 'CK3';
  else if (score === 3) ck = 'CK2';
  else if (score === 2) ck = 'CK1';
  return { ck, score };
}

// ---------------------------------------------------------------- analyze
/**
 * analyze(candles, opts) -> laporan penuh.
 * opts.htfCandles : candle timeframe lebih tinggi untuk pengesahan (optional)
 */
function analyze(candles, opts = {}) {
  if (!Array.isArray(candles) || candles.length < 20) {
    return { ok: false, error: 'candle tidak cukup (perlu >= 20)' };
  }
  const c = candles.map((x) => ({
    time: x.time, open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: x.volume || 0,
  }));
  const swings = findSwings(c, 2);
  const trend = trendOf(swings);
  const dmd = detectDMD(c, swings);
  const bases = detectBases(c);
  const qm = detectQM(c, swings);
  const qmc = detectQMC(c, swings);
  const bs = detectBlindspot(c);
  const mef = detectMEF(c, swings);
  const snr = findSNR(c, swings);

  const lastIdx = c.length - 1;
  const price = c[lastIdx].close;
  const atr = c.slice(-14).reduce((a, x) => a + range(x), 0) / Math.min(14, c.length);

  // Konfluensi engulfing pada 3 candle terakhir
  let lastEngulf = null;
  for (let i = lastIdx; i >= Math.max(1, lastIdx - 3); i--) {
    const e = engulfType(candles, i);
    if (e) { lastEngulf = { bias: e.bias, i, type: e.type }; break; }
  }
  const snrNear = snr.find((s) => Math.abs(s.distancePct) < 0.8) || null;

  // Kesan trendline (2 swing sama arah, sentuhan ke-3)
  const tlSell = qmc.some((q) => q.bias === 'bear' && q.i >= lastIdx - 5);
  const tlBuy = qmc.some((q) => q.bias === 'bull' && q.i >= lastIdx - 5);

  // ---- 5SOP Najmi (Low Risk entry) ----
  // SOP1 Zone: harga dekat zon SNR sah (ada 2nd movement)
  // SOP2 Rejection: wick tolak dari zon
  // SOP3 Confirmation: engulfing (type 1/2/3)
  // SOP4 Setup: QMR / MEF / BSD / QMC / SNRC
  // SOP5 Entry: hanya bila 4 di atas lengkap
  const rejections = detectRejection(c, swings);
  const recentRej = rejections.filter((r) => r.i >= lastIdx - 8);
  const rejBull = recentRej.some((r) => r.bias === 'bull');
  const rejBear = recentRej.some((r) => r.bias === 'bear');

  const inZone = (bias) => {
    if (!snr.length) return false;
    const z = snr.filter((s) => Math.abs(s.distancePct) < 1.2);
    if (!z.length) return false;
    return bias === 'bull' ? z.some((s) => s.role === 'support') : z.some((s) => s.role === 'resistance');
  };

  // Skor 5SOP per arah — menentukan "Low Risk" sebenar
  const sop = {
    bull: {
      zone: inZone('bull'),
      rejection: rejBull,
      confirmation: !!lastEngulf && lastEngulf.bias === 'bull',
      htf: opts.htfConfirm === 'bull',
    },
    bear: {
      zone: inZone('bear'),
      rejection: rejBear,
      confirmation: !!lastEngulf && lastEngulf.bias === 'bear',
      htf: opts.htfConfirm === 'bear',
    },
  };
  const sopCount = (b) => [sop[b].zone, sop[b].rejection, sop[b].confirmation, sop[b].htf].filter(Boolean).length;

  // Arah direction terkini (DMD dalam 40 candle terakhir)
  const dirRecent = dmd.filter((d) => d.i >= lastIdx - 40).slice(-1)[0] || null;

  // Calon setup terkini
  const recent = (arr, n = 30) => arr.filter((x) => x.i >= lastIdx - n);
  const candidates = [
    ...recent(qm).map((x) => ({ ...x, name: 'QMR', risk: 'high' })),
    ...recent(qmc),
    ...recent(bases).map((x) => ({
      ...x,
      // SNRC1 = RBR/DBD di SnR kuat; SNRC2 = RBD/DBR di SnR kuat
      name: (x.type === 'RBR' || x.type === 'DBD') ? 'SNRC1' : 'SNRC2',
    })),
    ...recent(bs),
    ...recent(mef),
  ].sort((a, b) => b.i - a.i);

  // Skor signal: direction + setup + confluence
  const scored = candidates.slice(0, 12).map((s) => {
    const agreesDir = dirRecent ? dirRecent.bias === s.bias : null;
    const sopN = sopCount(s.bias);
    const { ck, score } = gradeConfluence({
      snrNear: !!snrNear && (
        (s.bias === 'bull' && snrNear.role === 'support') ||
        (s.bias === 'bear' && snrNear.role === 'resistance')
      ),
      trendline: s.bias === 'bull' ? tlBuy : tlSell,
      engulfing: !!lastEngulf && lastEngulf.bias === s.bias,
      htfConfirm: opts.htfConfirm === s.bias,
    });
    // confidence: asas + konfluensi + 5SOP (setiap SOP = 10 mata) + direction
    let conf = 25 + score * 12 + sopN * 10;
    if (agreesDir) conf += 12;
    if (agreesDir === false) conf -= 12;
    // setup yang memang low-risk (QMC/SNRC) +/-, high-risk (QMR/MEF/BSD) -
    if (s.risk === 'low') conf += 5;
    if (s.risk === 'high') conf -= 6;
    if (s.risk === 'high' && sopN >= 3) conf += 8; // HTF confirm selamatkan high-risk
    // setup lebih lama = kurang relevan
    conf -= Math.min(15, (lastIdx - s.i) * 1.5);
    return { ...s, ck, conf: Math.max(5, Math.min(98, Math.round(conf))), agreesDir, sopN };
  }).sort((a, b) => b.conf - a.conf);

  const top = scored[0] || null;

  // Trade plan ikut disiplin Bystra: SL di luar structure swing近, TP1 = 1R, TP2 = swing next
  let plan = null;
  if (top) {
    const buf = atr * 0.5;
    const bull = top.bias === 'bull';
    // swing reference: swing terakhir yang relevan (bukan minimum 12 candle penuh)
    const recentSw = swings.filter((s) => s.i >= lastIdx - 15);
    const swingRef = bull
      ? (recentSw.filter((s) => s.type === 'L').slice(-1)[0] || { price: price - atr }).price
      : (recentSw.filter((s) => s.type === 'H').slice(-1)[0] || { price: price + atr }).price;
    const entry = price;
    // SL: minimum 1 ATR dari entry, di luar swing; cap jarak supaya R:R masih munasabah
    const rawSl = bull ? Math.min(swingRef - buf, entry - atr * 1.2) : Math.max(swingRef + buf, entry + atr * 1.2);
    const maxSlDist = atr * 2.5;
    const sl = bull ? Math.max(rawSl, entry - maxSlDist) : Math.min(rawSl, entry + maxSlDist);
    const risk = Math.abs(entry - sl) || atr;
    const tp1 = bull ? entry + risk : entry - risk;
    // TP2: swing seterusnya (liquidity pool) atau 2R
    const nextSw = bull
      ? recentSw.filter((s) => s.type === 'H' && s.price > entry).slice(-1)[0]
      : recentSw.filter((s) => s.type === 'L' && s.price < entry).slice(-1)[0];
    const tp2raw = nextSw ? nextSw.price : (bull ? entry + risk * 2 : entry - risk * 2);
    const tp2 = bull ? Math.max(tp2raw, tp1 + risk * 0.5) : Math.min(tp2raw, tp1 - risk * 0.5);
    plan = {
      bias: top.bias, setup: top.name, ck: top.ck,
      entry: +entry.toFixed(3), sl: +sl.toFixed(3), tp1: +tp1.toFixed(3), tp2: +tp2.toFixed(3),
      riskPips: +risk.toFixed(3),
      rr1: 1, rr2: +(Math.abs(tp2 - entry) / risk).toFixed(2),
      confidence: top.conf,
      atr: +atr.toFixed(3),
    };
  }

  // Ringkasan naratif (Bahasa Melayu, ikut susunan SOP Najmi + Bystra)
  const dirTxt = dirRecent
    ? `Direction ${dirRecent.type} ${dirRecent.bias === 'bull' ? 'naik' : 'turun'} (zon ${dirRecent.zone.bottom.toFixed(2)}–${dirRecent.zone.top.toFixed(2)})`
    : `Tiada DMD sah; struktur ${trend === 'up' ? 'naik' : trend === 'down' ? 'turun' : 'sisi'}`;

  return {
    ok: true,
    symbol: opts.symbol || null,
    interval: opts.interval || null,
    price: +price.toFixed(3),
    atr: +atr.toFixed(3),
    trend,
    direction: dirRecent,
    summary: dirTxt,
    counts: {
      swings: swings.length, dmd: dmd.length, bases: bases.length,
      qmr: qm.length, qmc: qmc.length, blindspot: bs.length, mef: mef.length, snr: snr.length,
    },
    snr: snr.slice(0, 6),
    engulfing: lastEngulf ? { bias: lastEngulf.bias, i: lastEngulf.i, type: lastEngulf.type } : null,
    rejections: recentRej.slice(-3),
    sop,
    sopScore: { bull: sopCount('bull'), bear: sopCount('bear') },
    setups: scored.slice(0, 6).map((s) => ({
      name: s.name, bias: s.bias, kind: s.kind, risk: s.risk,
      time: s.time, i: s.i, ck: s.ck, conf: s.conf, agreesDir: s.agreesDir, sop: s.sopN,
      level: s.level ? +s.level.toFixed(3) : null,
      zone: s.zone ? { top: +s.zone.top.toFixed(3), bottom: +s.zone.bottom.toFixed(3) } : null,
    })),
    plan,
    meta: { bars: c.length, generatedAt: new Date().toISOString(), engine: 'bystra-v1' },
  };
}

module.exports = {
  analyze, findSwings, trendOf, detectDMD, detectBases, detectQM, detectQMC,
  detectBlindspot, detectMEF, findSNR, gradeConfluence,
  isMarubozu, engulf, isBase,
};
