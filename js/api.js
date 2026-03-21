'use strict';

import { CFG, BINANCE_BASE, BYBIT_BASE, BB_INT } from './config.js';

// ══════════════════════════════════════════════════════════════════
//  API LAYER  —  Binance primary, Bybit fallback
// ══════════════════════════════════════════════════════════════════
export async function tryFetch(url, timeout = 12000) {
  // NOTE: AbortSignal cannot be cloned in all browser environments (DataCloneError).
  // Use Promise.race for timeout instead — no AbortSignal involved.
  const fetchPromise = fetch(url).then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${timeout}ms: ${url}`)), timeout)
  );
  return Promise.race([fetchPromise, timeoutPromise]);
}

// ── Binance public endpoints ──────────────────────────────────────
export const B = {
  ticker   : s => tryFetch(`${BINANCE_BASE}/fapi/v1/ticker/price?symbol=${s}`),
  premium  : s => tryFetch(`${BINANCE_BASE}/fapi/v1/premiumIndex?symbol=${s}`),
  klines   : (s,i,l) => tryFetch(`${BINANCE_BASE}/fapi/v1/klines?symbol=${s}&interval=${i}&limit=${l}`),
  oiHist   : s => tryFetch(`${BINANCE_BASE}/futures/data/openInterestHist?symbol=${s}&period=4h&limit=${CFG.OI_LIMIT}`),
  oiNow    : s => tryFetch(`${BINANCE_BASE}/fapi/v1/openInterest?symbol=${s}`),
};

// ── Bybit public endpoints ────────────────────────────────────────
export const Y = {
  ticker : async s => {
    const d = await tryFetch(`${BYBIT_BASE}/v5/market/tickers?category=linear&symbol=${s}`);
    const it = d?.result?.list?.[0];
    if (!it) throw new Error('Bybit: no ticker');
    return it; // {lastPrice, fundingRate, openInterest, …}
  },
  klines : async (s, interval, limit) => {
    const iv = BB_INT[interval] || interval;
    const d  = await tryFetch(`${BYBIT_BASE}/v5/market/kline?category=linear&symbol=${s}&interval=${iv}&limit=${limit}`);
    const list = d?.result?.list;
    if (!list) throw new Error('Bybit: no klines');
    // Bybit returns newest-first: [startTime,open,high,low,close,volume,turnover]
    // Convert to Binance format (oldest-first) with estimated taker buy vol at index [9]
    return [...list].reverse().map(k => {
      const [t,o,h,l,c,v] = k.map(Number);
      const rng = h - l;
      const buyVol = rng > 0 ? v * (c - l) / rng : v * 0.5; // Williams approximation
      // Binance kline indices: [0]=openTime [1]=o [2]=h [3]=l [4]=c [5]=vol [9]=takerBuyVol
      return [t, o, h, l, c, v, 0, 0, 0, buyVol, 0, 0];
    });
  },
  oiHist : async s => {
    const d = await tryFetch(`${BYBIT_BASE}/v5/market/open-interest?category=linear&symbol=${s}&intervalTime=4h&limit=${CFG.OI_LIMIT}`);
    const list = d?.result?.list;
    if (!list) throw new Error('Bybit: no OI hist');
    // Bybit: [{openInterest,timestamp},…] — ascending order
    return list.map(x => ({ sumOpenInterest: x.openInterest }));
  },
};

// ── Unified wrappers with fallback ───────────────────────────────
export async function fetchPriceFunding(name, symbol) {
  try {
    const [tk, pm] = await Promise.all([B.ticker(symbol), B.premium(symbol)]);
    return { price: parseFloat(tk.price), funding: parseFloat(pm.lastFundingRate) * 100, provider: 'Binance' };
  } catch(e) {
    console.warn(`[${name}] Binance price/funding failed (${e.message}), trying Bybit…`);
    const it = await Y.ticker(symbol);
    return { price: parseFloat(it.lastPrice), funding: parseFloat(it.fundingRate) * 100, provider: 'Bybit' };
  }
}

export async function fetchKlines(name, symbol, interval, limit) {
  try {
    return await B.klines(symbol, interval, limit);
  } catch(e) {
    console.warn(`[${name}] Binance klines(${interval}×${limit}) failed, trying Bybit…`);
    return await Y.klines(symbol, interval, limit);
  }
}

export async function fetchOI(name, symbol) {
  try {
    const hist = await B.oiHist(symbol);
    if (!hist || hist.length < 2) return { oiNow: null, oiChange: 0 };
    const oi0  = parseFloat(hist[0].sumOpenInterest);
    const oiN  = parseFloat(hist[hist.length-1].sumOpenInterest);
    const oiChange = oi0 > 0 ? (oiN - oi0) / oi0 * 100 : 0;
    const now  = await B.oiNow(symbol);
    return { oiNow: parseFloat(now.openInterest), oiChange };
  } catch(e) {
    console.warn(`[${name}] Binance OI failed, trying Bybit…`);
    try {
      const hist = await Y.oiHist(symbol);
      if (!hist || hist.length < 2) return { oiNow: null, oiChange: 0 };
      const oi0  = parseFloat(hist[0].sumOpenInterest);
      const oiN  = parseFloat(hist[hist.length-1].sumOpenInterest);
      const oiChange = oi0 > 0 ? (oiN - oi0) / oi0 * 100 : 0;
      const it   = await Y.ticker(symbol);
      return { oiNow: parseFloat(it.openInterest || 0), oiChange };
    } catch { return { oiNow: null, oiChange: 0 }; }
  }
}
