"use client";

import React, { useState, useMemo, useEffect } from "react";

// Force dynamic rendering (required for Supabase auth + live data)
export const dynamic = 'force-dynamic';
import {
  Play, RefreshCw, Download, Search, X, Star, StarOff, User, LogOut, Plus, Target
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format } from "date-fns";

import { NSE_UNIVERSE, shortSymbol } from "@/lib/symbols";
import type { RSResult } from "@/lib/analyzer";
import { formatINR, formatNumber, formatPercent, runWithConcurrency } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import SignInModal from "@/components/SignInModal";
import type { User as SupabaseUser } from "@supabase/supabase-js";

// Types
type ScanResult = RSResult & { scannedAt: string; rs3m?: number };

const CONCURRENCY = 6;
const NIFTY_SYMBOL = "^NSEI";

export default function NSERSScanner() {
  const supabase = createClient();

  // Auth
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<"scanner" | "watchlist">("scanner");

  // Scanner state
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<ScanResult[]>([]);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [nifty3m, setNifty3m] = useState<number>(0);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [aboveEmaOnly, setAboveEmaOnly] = useState(false);
  const [rsiAbove50, setRsiAbove50] = useState(false);
  const [strongRSOnly, setStrongRSOnly] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "rsi14",
    dir: "desc",
  });

  // Watchlist
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);
  const [watchlistResults, setWatchlistResults] = useState<ScanResult[]>([]);
  const [isLoadingWatchlist, setIsLoadingWatchlist] = useState(false);
  const [customTicker, setCustomTicker] = useState("");

  // Detail modal
  const [selectedStock, setSelectedStock] = useState<ScanResult | null>(null);

  const universeSize = NSE_UNIVERSE.length;

  // Load auth state
  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      // setAuthLoading was removed for lint
      if (user) {
        // Call after function declarations in the module evaluation
        setTimeout(() => loadWatchlistForUser(user.id), 0);
      }
    };
    loadUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        setAuthModalOpen(false);
        // Auto-switch to watchlist when user logs in
        setActiveTab("watchlist");
        // Load their list
        loadWatchlistForUser(session.user.id);
      } else {
        setWatchlistSymbols([]);
        setWatchlistResults([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load watchlist when user available
  async function loadWatchlistForUser(userId?: string) {
    const uid = userId || user?.id;
    if (!uid) return;

    setIsLoadingWatchlist(true);
    try {
      const { data, error } = await supabase
        .from("watchlist_items")
        .select("symbol")
        .eq("user_id", uid)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const symbols = (data || []).map((r: any) => r.symbol.toUpperCase());
      setWatchlistSymbols(symbols);

      if (symbols.length > 0) {
        await loadWatchlistData(symbols);
      } else {
        setWatchlistResults([]);
      }
    } catch (e: any) {
      console.error("Load watchlist error", e);
      // Table may not exist yet — user will see instructions
    } finally {
      setIsLoadingWatchlist(false);
    }
  }

  async function loadWatchlistData(symbols: string[]) {
    const newResults: ScanResult[] = [];
    let done = 0;

    const worker = async (sym: string) => {
      const res = await analyzeOne(sym);
      done++;
      if (res) {
        newResults.push({ ...res, scannedAt: new Date().toISOString() });
      }
    };

    await runWithConcurrency(symbols, 4, worker); // lower concurrency for watchlist
    setWatchlistResults(newResults);
  }

  // Analyze single symbol
  async function analyzeOne(rawSymbol: string): Promise<ScanResult | null> {
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: rawSymbol }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn(`Analyze failed for ${rawSymbol}:`, err);
        return null;
      }
      const data: RSResult = await res.json();
      return { ...data, scannedAt: new Date().toISOString() };
    } catch (e) {
      console.error("Fetch error", rawSymbol, e);
      return null;
    }
  }

  // Load Nifty 3M return (for RS calculation)
  async function loadNiftyReturns() {
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: NIFTY_SYMBOL }),
      });
      if (res.ok) {
        const n: RSResult = await res.json();
        setNifty3m(n.return3mPct || 0);
        return n.return3mPct || 0;
      }
    } catch (e) {
      console.warn("Nifty fetch failed, RS will be stock-only");
    }
    return 0;
  }

  // Main scanner
  const startScan = async () => {
    if (isScanning) return;

    setIsScanning(true);
    setResults([]);
    setSearchTerm("");
    setProgress({ done: 0, total: universeSize });

    const symbols = NSE_UNIVERSE.map(s => s.symbol);
    const newResults: ScanResult[] = [];
    let doneCount = 0;

    // Load Nifty once
    const n3m = await loadNiftyReturns();

    const worker = async (sym: string) => {
      const result = await analyzeOne(sym);
      doneCount++;
      setProgress({ done: doneCount, total: universeSize });

      if (result) {
        const rs3m = n3m ? Number((result.return3mPct - n3m).toFixed(1)) : result.return3mPct;
        const enriched: ScanResult = { ...result, rs3m, scannedAt: new Date().toISOString() };
        newResults.push(enriched);

        setResults(prev => {
          const merged = [...prev, enriched];
          const dedup = Array.from(new Map(merged.map(r => [r.symbol, r])).values());
          return dedup;
        });
      }
    };

    try {
      await runWithConcurrency(symbols, CONCURRENCY, worker);
      setLastScan(new Date());

      const aboveEma = newResults.filter(r => r.aboveEma50).length;
      toast.success(`Scan complete — ${newResults.length} stocks analyzed`, {
        description: `${aboveEma} trading above 50 EMA`,
      });
    } catch (e) {
      toast.error("Scan encountered an error");
    } finally {
      setIsScanning(false);
      setProgress({ done: 0, total: 0 });
    }
  };

  // Filtered + sorted results for scanner
  const filteredResults = useMemo(() => {
    let data = [...results];

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      data = data.filter(r =>
        r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
      );
    }
    if (aboveEmaOnly) data = data.filter(r => r.aboveEma50);
    if (rsiAbove50) data = data.filter(r => r.rsi14 >= 50);
    if (strongRSOnly) data = data.filter(r => (r.rs3m ?? 0) > 0);

    data.sort((a, b) => {
      let valA: any = (a as any)[sortConfig.key];
      let valB: any = (b as any)[sortConfig.key];
      if (valA == null) valA = -999999;
      if (valB == null) valB = -999999;
      if (valA < valB) return sortConfig.dir === "asc" ? -1 : 1;
      if (valA > valB) return sortConfig.dir === "asc" ? 1 : -1;
      return 0;
    });

    return data;
  }, [results, searchTerm, aboveEmaOnly, rsiAbove50, strongRSOnly, sortConfig]);

  // Watchlist derived
  const watchlistDisplay = useMemo(() => {
    return watchlistResults.map(r => ({
      ...r,
      rs3m: nifty3m ? Number((r.return3mPct - nifty3m).toFixed(1)) : r.return3mPct,
    }));
  }, [watchlistResults, nifty3m]);

  // KPIs
  const aboveEmaCount = results.filter(r => r.aboveEma50).length;
  const highRsiCount = results.filter(r => r.rsi14 >= 60).length;
  const strongRSCount = results.filter(r => (r.rs3m ?? 0) > 5).length;

  // Add / Remove watchlist (Supabase)
  async function addToWatchlist(symbol: string) {
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    const sym = shortSymbol(symbol).toUpperCase();

    // Optimistic
    if (watchlistSymbols.includes(sym)) return;

    setWatchlistSymbols(prev => [...prev, sym]);

    try {
      const { error } = await supabase
        .from("watchlist_items")
        .insert({ user_id: user.id, symbol: sym });

      if (error) {
        // Likely table missing — show helpful toast
        if (error.message.includes("relation") || error.message.includes("does not exist")) {
          toast.error("Watchlist table not found", {
            description: "Run the SQL in README to create watchlist_items in Supabase.",
          });
        } else {
          throw error;
        }
        // revert
        setWatchlistSymbols(prev => prev.filter(s => s !== sym));
        return;
      }

      toast.success(`Added ${sym} to watchlist`);

      // Load its data immediately if not already
      const existing = watchlistResults.find(r => r.symbol === sym);
      if (!existing) {
        const fresh = await analyzeOne(sym);
        if (fresh) {
          const enriched = { ...fresh, rs3m: nifty3m ? Number((fresh.return3mPct - nifty3m).toFixed(1)) : fresh.return3mPct, scannedAt: new Date().toISOString() } as ScanResult;
          setWatchlistResults(prev => [...prev, enriched]);
        }
      }
    } catch (e: any) {
      toast.error("Failed to save", { description: e.message });
      setWatchlistSymbols(prev => prev.filter(s => s !== sym));
    }
  }

  async function removeFromWatchlist(symbol: string) {
    if (!user) return;
    const sym = shortSymbol(symbol).toUpperCase();

    setWatchlistSymbols(prev => prev.filter(s => s !== sym));
    setWatchlistResults(prev => prev.filter(r => r.symbol !== sym));

    try {
      await supabase
        .from("watchlist_items")
        .delete()
        .eq("user_id", user.id)
        .eq("symbol", sym);
      toast(`Removed ${sym}`);
    } catch (e: any) {
      toast.error("Remove failed", { description: e.message });
    }
  }

  // Add custom ticker to watchlist
  async function addCustomTicker() {
    const raw = customTicker.trim().toUpperCase();
    if (!raw) return;

    const sym = raw.endsWith(".NS") ? raw.replace(".NS", "") : raw;

    if (watchlistSymbols.includes(sym)) {
      toast.info("Already in watchlist");
      setCustomTicker("");
      return;
    }

    setCustomTicker("");

    // Validate quickly by analyzing
    const result = await analyzeOne(sym);
    if (!result || result.ltp === 0) {
      toast.error("Could not fetch data", { description: `${sym} may not be a valid NSE ticker.` });
      return;
    }

    await addToWatchlist(sym);
  }

  const toggleSort = (key: string) => {
    setSortConfig(current => ({
      key,
      dir: current.key === key && current.dir === "asc" ? "desc" : "asc",
    }));
  };

  const exportCSV = (data: ScanResult[], filename: string) => {
    if (data.length === 0) {
      toast.error("No data to export");
      return;
    }

    const headers = ["Symbol", "Name", "LTP", "Chg1D%", "Volume", "RSI14", "EMA50", "AboveEMA50", "DistEMA%", "3MRet%", "RSvsNifty"];

    const rows = data.map(r => [
      r.symbol,
      `"${r.name.replace(/"/g, '""')}"`,
      r.ltp,
      r.change1dPct,
      r.volume,
      r.rsi14,
      r.ema50,
      r.aboveEma50 ? "YES" : "NO",
      r.distToEma50Pct,
      r.return3mPct,
      r.rs3m ?? "",
    ]);

    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}_${format(new Date(), "yyyy-MM-dd_HHmm")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${data.length} rows`);
  };

  const resetScanner = () => {
    setResults([]);
    setLastScan(null);
    setSearchTerm("");
    setAboveEmaOnly(false);
    setRsiAbove50(false);
    setStrongRSOnly(false);
    setNifty3m(0);
    toast("Scanner reset");
  };

  const isInWatchlist = (symbol: string) => watchlistSymbols.includes(shortSymbol(symbol).toUpperCase());

  // Render helpers
  function renderStockRow(row: ScanResult, isWatch = false) {
    const inWatch = isInWatchlist(row.symbol);
    return (
      <tr key={row.symbol} className="group">
        <td className="pl-5 py-3 font-mono text-emerald-300 font-semibold tracking-tight">{row.symbol}</td>
        <td className="py-3 text-zinc-300 pr-4 max-w-[210px] truncate">{row.name}</td>
        <td className="text-right py-3 tabular-nums font-medium">{formatINR(row.ltp)}</td>
        <td className={`text-right py-3 tabular-nums ${row.change1dPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {formatPercent(row.change1dPct)}
        </td>
        <td className="text-right py-3 tabular-nums text-amber-400 font-medium">{formatNumber(row.volume)}</td>
        <td className="text-right py-3 tabular-nums font-semibold">{row.rsi14}</td>
        <td className="text-right py-3 tabular-nums text-zinc-400">{formatINR(row.ema50)}</td>
        <td className="text-center py-3">
          <span className={`badge ${row.aboveEma50 ? "badge-green" : "badge-gray"}`}>
            {row.aboveEma50 ? "YES" : "NO"}
          </span>
        </td>
        <td className="text-right py-3 tabular-nums text-xs">
          {row.distToEma50Pct > 0 ? "+" : ""}{row.distToEma50Pct}%
        </td>
        <td className={`text-right py-3 tabular-nums font-medium ${ (row.rs3m ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {row.rs3m != null ? (row.rs3m > 0 ? "+" : "") + row.rs3m : "—"}
        </td>
        <td className="pr-4 text-right">
          {user ? (
            isWatch ? (
              <button
                onClick={() => removeFromWatchlist(row.symbol)}
                className="text-rose-400 hover:text-rose-300 opacity-70 group-hover:opacity-100 p-1"
                title="Remove from watchlist"
              >
                <StarOff className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => addToWatchlist(row.symbol)}
                disabled={inWatch}
                className={`p-1 ${inWatch ? "text-emerald-500" : "text-zinc-400 hover:text-emerald-400"}`}
                title={inWatch ? "In your watchlist" : "Add to watchlist"}
              >
                <Star className={`w-4 h-4 ${inWatch ? "fill-current" : ""}`} />
              </button>
            )
          ) : (
            <button onClick={() => setAuthModalOpen(true)} className="text-[10px] px-2 py-0.5 border border-white/10 rounded text-zinc-400 hover:text-white">
              SIGN IN
            </button>
          )}
          <button
            onClick={() => setSelectedStock(row)}
            className="ml-2 text-xs px-2.5 py-1 border border-white/10 rounded-lg hover:bg-white/5 opacity-60 group-hover:opacity-100"
          >
            DETAILS
          </button>
        </td>
      </tr>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-zinc-200">
      {/* Top Bar */}
      <div className="border-b border-white/10 bg-[#0a0f1a]/95 backdrop-blur-lg sticky top-0 z-50">
        <div className="max-w-[1480px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Target className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <div className="font-semibold tracking-tighter text-2xl">RS Scanner</div>
                <div className="text-[10px] text-emerald-400/70 -mt-1">NSE • RELATIVE STRENGTH + RSI + EMA50</div>
              </div>
            </div>
            <div className="ml-2 px-3 py-1 rounded-full bg-white/5 text-xs font-medium border border-white/10">
              Yahoo Finance
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm">
            {user ? (
              <div className="flex items-center gap-2 rounded-full border border-white/10 pl-1 pr-4 py-1 bg-white/5">
                <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <User className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-xs text-zinc-400 max-w-[140px] truncate">
                  {user.email || user.user_metadata?.full_name || "Signed in"}
                </div>
                <button onClick={async () => { await supabase.auth.signOut(); }} className="ml-1 text-zinc-400 hover:text-white p-1">
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAuthModalOpen(true)}
                className="flex items-center gap-2 px-4 h-9 rounded-xl bg-white text-black font-medium text-sm active:bg-zinc-200"
              >
                <User className="w-4 h-4" /> SIGN IN
              </button>
            )}

            <div className="text-xs text-zinc-500 hidden md:block">Data refreshes every few minutes</div>
          </div>
        </div>
      </div>

      <div className="max-w-[1480px] mx-auto px-6 pt-8 pb-24">
        {/* Hero */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <div className="uppercase tracking-[3px] text-emerald-400 text-xs font-semibold mb-1">MOMENTUM • TECHNICALS • PERSONAL</div>
            <h1 className="text-5xl md:text-6xl font-semibold tracking-tighter">NSE Relative Strength Scanner</h1>
            <p className="mt-3 max-w-2xl text-lg text-zinc-400">
              Scan 380+ NSE stocks for RSI, price vs 50 EMA, volume and 3-month Relative Strength vs Nifty.
              <span className="text-emerald-400"> Login to build a persistent personal watchlist.</span>
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <button
              onClick={startScan}
              disabled={isScanning}
              className="flex items-center justify-center gap-3 px-8 h-14 rounded-2xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 disabled:bg-zinc-700 disabled:text-zinc-400 transition-all text-lg font-semibold shadow-lg shadow-emerald-950/50"
            >
              {isScanning ? (
                <>SCANNING… <RefreshCw className="w-5 h-5 animate-spin" /></>
              ) : (
                <> <Play className="w-5 h-5" /> SCAN ALL STOCKS </>
              )}
            </button>
            <div className="text-[11px] text-zinc-500">~4–7 min first run • {CONCURRENCY} concurrent</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-6 border-b border-white/10">
          <button
            onClick={() => setActiveTab("scanner")}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition ${activeTab === "scanner" ? "border-emerald-500 text-white" : "border-transparent text-zinc-400 hover:text-white"}`}
          >
            MARKET SCANNER
          </button>
          <button
            onClick={() => setActiveTab("watchlist")}
            className={`px-5 py-3 text-sm font-medium border-b-2 flex items-center gap-2 transition ${activeTab === "watchlist" ? "border-emerald-500 text-white" : "border-transparent text-zinc-400 hover:text-white"}`}
          >
            MY WATCHLIST
            {watchlistSymbols.length > 0 && (
              <span className="text-[10px] px-1.5 py-px rounded bg-emerald-500/20 text-emerald-400">{watchlistSymbols.length}</span>
            )}
          </button>
        </div>

        {/* SCANNER TAB */}
        {activeTab === "scanner" && (
          <>
            {/* Filters */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
              <div className="lg:col-span-7 card p-5">
                <div className="font-medium flex items-center gap-2 mb-4 text-sm">
                  <Target className="w-4 h-4 text-emerald-400" /> FILTERS &amp; SORT
                </div>

                <div className="flex flex-wrap gap-2">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-400" />
                    <input
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search symbol or company..."
                      className="pl-9 w-64 h-9 rounded-xl text-sm border border-white/10 bg-black/30 focus:border-emerald-500/60"
                    />
                  </div>

                  <button onClick={() => setAboveEmaOnly(!aboveEmaOnly)} className={`h-9 px-4 rounded-xl text-xs font-medium border ${aboveEmaOnly ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "border-white/10 hover:bg-white/5"}`}>
                    ABOVE 50 EMA ONLY
                  </button>
                  <button onClick={() => setRsiAbove50(!rsiAbove50)} className={`h-9 px-4 rounded-xl text-xs font-medium border ${rsiAbove50 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "border-white/10 hover:bg-white/5"}`}>
                    RSI ≥ 50
                  </button>
                  <button onClick={() => setStrongRSOnly(!strongRSOnly)} className={`h-9 px-4 rounded-xl text-xs font-medium border ${strongRSOnly ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "border-white/10 hover:bg-white/5"}`}>
                    OUTPERFORMING NIFTY (RS &gt; 0)
                  </button>

                  <button onClick={resetScanner} className="h-9 px-4 rounded-xl text-xs border border-white/10 hover:bg-white/5 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" /> RESET
                  </button>
                </div>
              </div>

              <div className="lg:col-span-5 card p-5 flex items-center text-sm text-zinc-400">
                Login with Google or email to star stocks and build a watchlist that appears every time you return.
                Strong RS = stock 3M return beats Nifty 3M return.
              </div>
            </div>

            {/* Progress */}
            <AnimatePresence>
              {isScanning && progress.total > 0 && (
                <div className="mb-6 card p-4">
                  <div className="flex items-center justify-between mb-2 text-sm">
                    <div>SCANNING IN PROGRESS <span className="font-mono text-emerald-400">{progress.done} / {progress.total}</span></div>
                  </div>
                  <div className="progress"><div className="progress-bar bg-emerald-500" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div>
                  <div className="text-[11px] text-zinc-500 mt-1.5">Fetching history + computing RSI(14), 50 EMA, 3M &amp; 6M returns • Concurrency {CONCURRENCY}</div>
                </div>
              )}
            </AnimatePresence>

            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              <div className="card p-5">
                <div className="text-xs uppercase tracking-widest text-zinc-400">STOCKS ANALYZED</div>
                <div className="text-5xl font-semibold tabular-nums mt-2">{results.length}</div>
                <div className="text-emerald-400 text-sm mt-1">of {universeSize}</div>
              </div>
              <div className="card p-5 border-emerald-500/30">
                <div className="text-xs uppercase tracking-widest text-emerald-400">ABOVE 50 EMA</div>
                <div className="text-5xl font-semibold tabular-nums mt-2 text-emerald-400">{aboveEmaCount}</div>
              </div>
              <div className="card p-5 border-amber-500/30">
                <div className="text-xs uppercase tracking-widest text-amber-400">RSI ≥ 60</div>
                <div className="text-5xl font-semibold tabular-nums mt-2 text-amber-400">{highRsiCount}</div>
              </div>
              <div className="card p-5 border-sky-500/30">
                <div className="text-xs uppercase tracking-widest text-sky-400">STRONG RS (&gt;+5%)</div>
                <div className="text-5xl font-semibold tabular-nums mt-2 text-sky-400">{strongRSCount}</div>
              </div>
              <div className="card p-5 flex flex-col justify-between">
                <div>
                  <div className="text-xs uppercase tracking-widest text-zinc-400">LAST SCAN</div>
                  <div className="text-lg font-medium mt-1">{lastScan ? format(lastScan, "HH:mm") : "—"}</div>
                </div>
                <button onClick={() => exportCSV(filteredResults, "nse_rs_scan")} disabled={filteredResults.length === 0} className="mt-3 self-start flex items-center gap-2 text-xs px-4 h-9 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40">
                  <Download className="w-3.5 h-3.5" /> EXPORT CSV
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="card p-2">
              <div className="flex items-center justify-between px-4 pt-4 pb-3">
                <div className="font-semibold">SCAN RESULTS <span className="text-emerald-400 text-sm font-normal">({filteredResults.length} shown)</span></div>
                {results.length > 0 && <div className="text-xs text-zinc-500">{results.length} analyzed • Nifty 3M: {nifty3m ? nifty3m.toFixed(1) + "%" : "—"}</div>}
              </div>

              <div className="overflow-x-auto">
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr className="table-header text-xs">
                      <th className="text-left pl-5 py-3 cursor-pointer" onClick={() => toggleSort("symbol")}>SYMBOL</th>
                      <th className="text-left py-3 cursor-pointer" onClick={() => toggleSort("name")}>NAME</th>
                      <th className="text-right py-3 cursor-pointer" onClick={() => toggleSort("ltp")}>LTP (₹)</th>
                      <th className="text-right py-3 cursor-pointer" onClick={() => toggleSort("change1dPct")}>1D CHG</th>
                      <th className="text-right py-3 cursor-pointer" onClick={() => toggleSort("volume")}>VOLUME</th>
                      <th className="text-right py-3 cursor-pointer" onClick={() => toggleSort("rsi14")}>RSI 14</th>
                      <th className="text-right py-3 cursor-pointer" onClick={() => toggleSort("ema50")}>50 EMA</th>
                      <th className="text-center py-3 cursor-pointer" onClick={() => toggleSort("aboveEma50")}>ABOVE EMA</th>
                      <th className="text-right py-3">DIST EMA</th>
                      <th className="text-right py-3 cursor-pointer" onClick={() => toggleSort("rs3m")}>RS vs NIFTY</th>
                      <th className="w-24"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredResults.length === 0 && (
                      <tr>
                        <td colSpan={11} className="py-16 text-center text-zinc-400">
                          {results.length === 0 ? "Click the big green SCAN button to analyze the full NSE universe." : "No stocks match current filters."}
                        </td>
                      </tr>
                    )}
                    {filteredResults.map(row => renderStockRow(row))}
                  </tbody>
                </table>
              </div>
              {results.length > 0 && (
                <div className="px-4 py-3 text-xs text-zinc-500 border-t border-white/10">
                  RS vs Nifty = Stock 3-month return minus Nifty 50 3-month return. Positive = outperformed the market.
                </div>
              )}
            </div>
          </>
        )}

        {/* WATCHLIST TAB */}
        {activeTab === "watchlist" && (
          <div>
            {!user ? (
              <div className="card p-10 text-center max-w-md mx-auto mt-6">
                <Star className="w-10 h-10 mx-auto text-emerald-400 mb-4" />
                <div className="text-2xl font-semibold">Your personal watchlist</div>
                <p className="text-zinc-400 mt-3">Sign in with Google or email. Add stocks from the scanner or by ticker. Your list saves forever and loads automatically next time.</p>
                <button onClick={() => setAuthModalOpen(true)} className="mt-6 px-8 h-11 rounded-2xl bg-white text-black font-semibold">Sign in to continue</button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="font-semibold text-xl flex items-center gap-2">My Watchlist <span className="text-emerald-400 text-base font-normal">({watchlistSymbols.length})</span></div>
                    <div className="text-xs text-zinc-500">Stocks you select are saved to your account</div>
                  </div>
                  <button onClick={() => exportCSV(watchlistDisplay, "my_watchlist")} disabled={watchlistDisplay.length === 0} className="flex items-center gap-2 text-xs px-4 h-9 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40">
                    <Download className="w-3.5 h-3.5" /> EXPORT
                  </button>
                </div>

                {/* Add custom */}
                <div className="card p-4 mb-6 flex flex-col sm:flex-row gap-3 items-center">
                  <div className="flex-1 text-sm text-zinc-400">Add any NSE stock by ticker (e.g. TATAMOTORS, SBIN, or RELIANCE)</div>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <input
                      value={customTicker}
                      onChange={e => setCustomTicker(e.target.value.toUpperCase())}
                      onKeyDown={e => e.key === "Enter" && addCustomTicker()}
                      placeholder="TICKER"
                      className="flex-1 sm:w-48 h-10 rounded-xl border border-white/10 bg-black/30 px-4 font-mono uppercase text-sm"
                    />
                    <button onClick={addCustomTicker} disabled={!customTicker.trim()} className="h-10 px-5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-700 font-medium flex items-center gap-2 text-sm">
                      <Plus className="w-4 h-4" /> ADD
                    </button>
                  </div>
                </div>

                {isLoadingWatchlist && <div className="text-sm text-zinc-400 mb-3">Loading your saved stocks…</div>}

                <div className="card p-2">
                  <div className="overflow-x-auto">
                    <table className="data-table w-full text-sm">
                      <thead>
                        <tr className="table-header text-xs">
                          <th className="pl-5 py-3 text-left">SYMBOL</th>
                          <th className="py-3 text-left">NAME</th>
                          <th className="py-3 text-right">LTP</th>
                          <th className="py-3 text-right">1D</th>
                          <th className="py-3 text-right">VOL</th>
                          <th className="py-3 text-right">RSI</th>
                          <th className="py-3 text-right">50EMA</th>
                          <th className="py-3 text-center">ABOVE</th>
                          <th className="py-3 text-right">RS 3M</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {watchlistDisplay.length === 0 && (
                          <tr><td colSpan={10} className="py-12 text-center text-zinc-400">No stocks yet. Go to Market Scanner and click the ★ to add, or use the Add box above.</td></tr>
                        )}
                        {watchlistDisplay.map(row => renderStockRow(row, true))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-4 text-xs text-zinc-500">Tip: Add from the full scanner above for the best experience. Data is cached ~3 minutes.</div>
              </>
            )}
          </div>
        )}

        <div className="mt-10 text-center text-xs text-zinc-500 max-w-md mx-auto">
          Not investment advice. All data from Yahoo Finance (delayed). RSI &amp; EMA calculated on daily closes. RS = 3-month relative performance vs Nifty.
        </div>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedStock && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" onClick={() => setSelectedStock(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 20 }}
              onClick={e => e.stopPropagation()}
              className="modal w-full max-w-[860px] bg-[#0f1629] border border-white/10 rounded-3xl overflow-hidden"
            >
              <div className="px-7 pt-6 pb-4 flex justify-between border-b border-white/10">
                <div>
                  <div className="font-mono text-4xl font-semibold tracking-[-1.5px]">{selectedStock.symbol}</div>
                  <div className="text-zinc-400 text-xl mt-0.5">{selectedStock.name}</div>
                </div>
                <button onClick={() => setSelectedStock(null)}><X className="w-5 h-5" /></button>
              </div>

              <div className="p-7 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                {[
                  ["Last Price", formatINR(selectedStock.ltp)],
                  ["Daily Change", formatPercent(selectedStock.change1dPct)],
                  ["Volume", formatNumber(selectedStock.volume)],
                  ["RSI (14)", selectedStock.rsi14],
                  ["50-Day EMA", formatINR(selectedStock.ema50)],
                  ["Price vs EMA50", `${selectedStock.aboveEma50 ? "+" : ""}${selectedStock.distToEma50Pct}%`],
                  ["3-Month Return", formatPercent(selectedStock.return3mPct)],
                  ["6-Month Return", formatPercent(selectedStock.return6mPct)],
                  ["RS vs Nifty (3M)", selectedStock.rs3m != null ? (selectedStock.rs3m > 0 ? "+" : "") + selectedStock.rs3m + "%" : "—"],
                ].map(([label, val], i) => (
                  <div key={i} className="rounded-2xl bg-black/30 border border-white/10 p-4">
                    <div className="text-[10px] tracking-widest text-zinc-400">{label}</div>
                    <div className="mt-1.5 text-2xl font-semibold tabular-nums text-emerald-400">{val}</div>
                  </div>
                ))}
              </div>

              <div className="px-7 py-5 border-t border-white/10 bg-black/20 flex justify-between items-center text-xs">
                <div className="text-zinc-500">Last computed from Yahoo daily data</div>
                <div className="flex gap-3">
                  {user && !isInWatchlist(selectedStock.symbol) && (
                    <button onClick={() => { addToWatchlist(selectedStock.symbol); setSelectedStock(null); }} className="px-4 py-2 rounded-xl border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">★ ADD TO WATCHLIST</button>
                  )}
                  <button onClick={() => setSelectedStock(null)} className="px-5 py-2 rounded-xl border border-white/10 hover:bg-white/5">CLOSE</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <SignInModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  );
}
