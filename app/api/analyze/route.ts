import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { computeIndicators } from "@/lib/analyzer";
import { toYahooSymbol } from "@/lib/symbols";

/* eslint-disable @typescript-eslint/no-explicit-any */


const yahoo = new YahooFinance() as any; // yahoo-finance2 types are loose

// 3 minute in-memory cache
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL_MS = 1000 * 60 * 3;

interface AnalyzeRequest {
  symbol: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: AnalyzeRequest = await req.json();
    const rawSymbol = (body.symbol || "").toUpperCase().trim();
    if (!rawSymbol) {
      return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }

    const ySymbol = toYahooSymbol(rawSymbol);

    // Cache
    const cached = cache.get(ySymbol);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    // Fetch ~200 days history (enough for RSI14 + EMA50 + 6m returns)
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 220);

    const hist = await (yahoo as any).historical(ySymbol, {
      period1: start,
      period2: end,
      interval: "1d",
    });

    if (!hist || hist.length === 0) {
      return NextResponse.json({ error: `No data for ${rawSymbol}` }, { status: 404 });
    }

    const candles = hist
      .filter((r: any) => r.close != null)
      .map((r: any) => ({
        date: r.date.toISOString().slice(0, 10),
        timestamp: r.date.getTime(),
        open: r.open ?? 0,
        high: r.high ?? 0,
        low: r.low ?? 0,
        close: r.close,
        volume: r.volume ?? 0,
      }))
      .sort((a: any, b: any) => a.timestamp - b.timestamp);

    // Current quote for accurate LTP, change, volume, name
    let ltp = candles[candles.length - 1]?.close ?? 0;
    let change1dPct = 0;
    let displayName = rawSymbol;
    let volume = candles[candles.length - 1]?.volume ?? 0;

    try {
      const quote: any = await yahoo.quote(ySymbol);
      if (quote?.regularMarketPrice) ltp = quote.regularMarketPrice;
      if (quote?.regularMarketChangePercent != null) change1dPct = quote.regularMarketChangePercent;
      if (quote?.shortName) displayName = quote.shortName;
      if (quote?.regularMarketVolume) volume = quote.regularMarketVolume;
    } catch (e) {
      // history fallback ok
    }

    const result = computeIndicators(
      rawSymbol,
      displayName,
      ltp,
      change1dPct,
      volume,
      candles
    );

    cache.set(ySymbol, { data: result, ts: Date.now() });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Analyze error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to analyze stock" },
      { status: 500 }
    );
  }
}
