import { toYahooSymbol } from "./symbols";

export interface DailyCandle {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RSResult {
  symbol: string;           // without .NS
  name: string;
  ltp: number;
  change1dPct: number;
  volume: number;           // today's volume
  rsi14: number;
  ema50: number;
  aboveEma50: boolean;
  distToEma50Pct: number;   // positive = price above EMA
  return3mPct: number;      // ~63 trading days
  return6mPct: number;
  lastUpdated: string;
}

function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = [];
  if (prices.length === 0) return ema;

  const multiplier = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < Math.min(period, prices.length); i++) {
    sum += prices[i];
  }
  let prev = sum / Math.min(period, prices.length);
  ema.push(prev);

  for (let i = Math.min(period, prices.length); i < prices.length; i++) {
    prev = (prices[i] - prev) * multiplier + prev;
    ema.push(prev);
  }
  return ema;
}

function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 0;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Smooth the rest
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function getReturnPct(candles: DailyCandle[], daysBack: number): number {
  if (candles.length < daysBack + 1) return 0;
  // Sort ascending
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const latest = sorted[sorted.length - 1].close;
  const past = sorted[sorted.length - 1 - daysBack].close;
  if (past <= 0) return 0;
  return ((latest - past) / past) * 100;
}

export async function fetchAndAnalyze(
  rawSymbol: string,
  displayName?: string
): Promise<RSResult | null> {
  // This will be called from API route
  // Placeholder - actual impl in route using yahoo-finance2 + these calcs
  return null;
}

export function computeIndicators(
  symbol: string,
  name: string,
  ltp: number,
  change1dPct: number,
  volume: number,
  candles: DailyCandle[]
): RSResult {
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const closes = sorted.map(c => c.close).filter(c => c > 0);

  const rsi14 = closes.length > 20 ? Number(calculateRSI(closes, 14).toFixed(1)) : 0;

  const emaValues = calculateEMA(closes, 50);
  const ema50 = emaValues.length > 0 ? emaValues[emaValues.length - 1] : 0;
  const aboveEma50 = ltp > ema50 && ema50 > 0;
  const distToEma50Pct = ema50 > 0 ? Number(((ltp - ema50) / ema50) * 100).toFixed(2) as any : 0;

  // ~3 months ~63 trading days, 6m ~126
  const return3mPct = Number(getReturnPct(sorted, Math.min(63, sorted.length - 1)).toFixed(1));
  const return6mPct = Number(getReturnPct(sorted, Math.min(126, sorted.length - 1)).toFixed(1));

  return {
    symbol: symbol.replace(".NS", "").toUpperCase(),
    name: name || symbol,
    ltp: Number(ltp.toFixed(2)),
    change1dPct: Number(change1dPct.toFixed(1)),
    volume,
    rsi14,
    ema50: ema50 ? Number(ema50.toFixed(2)) : 0,
    aboveEma50,
    distToEma50Pct: Number(distToEma50Pct),
    return3mPct,
    return6mPct,
    lastUpdated: new Date().toISOString(),
  };
}
