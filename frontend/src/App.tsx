import { useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronRight, ExternalLink, LoaderCircle, Search, Star, TrendingUp } from "lucide-react";

import { addYahooStock, fetchStockChart, fetchStocks, removeTrackedStock, searchYahooStocks, type AuthTokens, type AuthUser } from "./api";
import { AIAnalysisPanel } from "./components/mobile/AIAnalysisPanel";
import BottomNav, { type TabId } from "./components/mobile/BottomNav";
import ChartSection from "./components/mobile/ChartSection";
import Header from "./components/mobile/Header";
import { LoginScreen } from "./components/mobile/LoginScreen";
import MeView from "./components/mobile/MeView";
import NestedDetails from "./components/mobile/NestedDetails";
import StockCard from "./components/mobile/StockCard";
import type { ChartPoint, DetailNode, StockApiResponse, StockAppSchema, StockPosition, YahooChartResponse, YahooStockResult } from "./types/stock";
import { useLanguage } from "./i18n";

const ACCESS_KEY = "pickinggeek_access";
const REFRESH_KEY = "pickinggeek_refresh";
const USER_KEY = "pickinggeek_user";
const POPULAR_SYMBOLS = ["VOO", "QQQ", "NVDA", "AAPL", "BTC-USD", "GC=F"];
const TW_POPULAR_SYMBOLS = ['2330', '2317', '2454', '0050', '0056', '6488'];

function makeChart(base: number, offset = 0): ChartPoint[] {
  return Array.from({ length: 36 }, (_, index) => {
    const wave = Math.sin((index + offset) / 4.2) * base * 0.035;
    const trend = base * (index - 18) * 0.0022;
    const price = base + wave + trend;
    return { date: `${index + 1}日`, price: Number(price.toFixed(2)), ma60: Number((base + trend * 0.62 + Math.sin(index / 8) * base * 0.012).toFixed(2)), ma200: Number((base - base * 0.045 + trend * 0.2).toFixed(2)) };
  });
}

function tone(value: boolean | null | undefined): "positive" | "negative" | "neutral" {
  return value == null ? "neutral" : value ? "positive" : "negative";
}

function detailNodes(stock: StockApiResponse): DetailNode[] {
  const indicator = stock.indicator;
  if (!indicator) return [{ id: "pending", label: "技術指標", value: "等待每日更新", tone: "neutral" }];
  return [
    { id: "momentum", label: "動能指標", children: [
      { id: "macd", label: "MACD 狀態", value: indicator.macd_status, tone: indicator.macd_status === "BULLISH" ? "positive" : indicator.macd_status === "BEARISH" ? "negative" : "neutral" },
      { id: "histogram", label: "柱狀圖", value: indicator.macd_histogram ?? "--", tone: "neutral" },
    ] },
    { id: "averages", label: "移動平均線", children: [
      { id: "ma60", label: "MA60", value: indicator.ma60 ?? "--", tone: tone(indicator.above_ma60) },
      { id: "ma100", label: "MA100", value: indicator.ma100 ?? "--", tone: tone(indicator.above_ma100) },
      { id: "ma200", label: "MA200", value: indicator.ma200 ?? "--", tone: tone(indicator.above_ma200) },
    ] },
  ];
}

function toPosition(stock: StockApiResponse, index: number): StockPosition {
  const currentPrice = Number(stock.indicator?.close_price || (stock.market === "TW" ? 1045 : stock.symbol === "NVDA" ? 228.5 : 198.72));
  const chartData = stock.indicator?.chart_points?.length ? stock.indicator.chart_points : makeChart(currentPrice, index * 3);
  const previous = chartData.at(-2)?.price ?? currentPrice;
  const latest = chartData.at(-1)?.price ?? currentPrice;
  return { ...stock, currentPrice: latest, changePercent: previous ? ((latest - previous) / previous) * 100 : 0, chartData, nestedDetails: detailNodes(stock) };
}

const fallbackStocks: StockPosition[] = [
  { id: 1, symbol: "NVDA", market: "US", name: "Nvidia", currency: "USD", currentPrice: 228.5, changePercent: 1.82, indicator: null, chartData: makeChart(228.5), nestedDetails: [{ id: "macd", label: "MACD", value: "BULLISH", tone: "positive" }, { id: "ma", label: "均線訊號", children: [{ id: "ma60", label: "MA60", value: "站上", tone: "positive" }, { id: "ma200", label: "MA200", value: "站上", tone: "positive" }] }] },
  { id: 2, symbol: "AAPL", market: "US", name: "Apple", currency: "USD", currentPrice: 198.72, changePercent: -0.36, indicator: null, chartData: makeChart(198.72, 5), nestedDetails: [{ id: "macd", label: "MACD", value: "NEUTRAL", tone: "neutral" }] },
  { id: 3, symbol: "2330", market: "TW", name: "台積電", currency: "TWD", currentPrice: 1045, changePercent: 1.46, indicator: null, chartData: makeChart(1045, 9), nestedDetails: [{ id: "macd", label: "MACD", value: "BULLISH", tone: "positive" }] },
];

function IndexView({ stocks, onOpen }: { stocks: StockPosition[]; onOpen: (stock: StockPosition) => void }) {
  const { t } = useLanguage();
  return <div className="px-5 py-5"><div className="mb-5"><p className="text-xs font-semibold text-sky-700">{t("brandName")}</p><h1 className="mt-1 text-2xl font-black text-slate-950">{t("todayMarket")}</h1></div><div className="grid grid-cols-2 gap-3"><div className="rounded-md bg-slate-950 p-4 text-white"><p className="text-xs text-slate-400">{t("trackedAssets")}</p><strong className="mt-2 block text-3xl">{stocks.length}</strong></div><div className="rounded-md bg-emerald-50 p-4 text-emerald-800"><p className="text-xs text-emerald-600">{t("bullishSignals")}</p><strong className="mt-2 block text-3xl">{stocks.filter((item) => item.changePercent >= 0).length}</strong></div></div><h2 className="mb-2 mt-6 text-sm font-bold text-slate-950">{t("marketSnapshot")}</h2><div className="divide-y divide-slate-100 border-y border-slate-100">{stocks.map((stock) => <button key={stock.id} type="button" onClick={() => onOpen(stock)} className="flex w-full items-center gap-3 py-4 text-left"><span className="grid size-10 place-items-center rounded-md bg-slate-100 text-slate-700"><BarChart3 size={18} /></span><span className="min-w-0 flex-1"><strong className="block text-sm text-slate-900">{stock.name}</strong><small className="text-slate-400">{stock.symbol} · {stock.market}</small></span><span className={`text-sm font-bold ${stock.changePercent >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{stock.changePercent >= 0 ? "+" : ""}{stock.changePercent.toFixed(2)}%</span><ChevronRight size={16} className="text-slate-300" /></button>)}</div></div>;
}

function SearchView({ token, stocks, onOpen, onAdd }: { token: string; stocks: StockPosition[]; onOpen: (stock: StockPosition) => void; onAdd: (stock: StockApiResponse) => void }) {
  const { t, language } = useLanguage();
  const [market, setMarket] = useState<'US' | 'TW'>('US');
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YahooStockResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [addingSymbol, setAddingSymbol] = useState("");
  const [addError, setAddError] = useState("");

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) { setResults([]); setLoading(false); setError(false); return; }
    const controller = new AbortController();
    let interval = 0;
    let firstRequest = true;
    let inFlight = false;
    const refreshResults = async () => {
      if (inFlight) return;
      inFlight = true;
      if (firstRequest) setLoading(true);
      setError(false);
      try {
        const rows = await searchYahooStocks(token, normalized, controller.signal, market);
        if (!controller.signal.aborted) setResults(rows);
      }
      catch (searchError) { if (!controller.signal.aborted && !(searchError instanceof DOMException && searchError.name === "AbortError")) setError(true); }
      finally {
        inFlight = false;
        firstRequest = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    const timer = window.setTimeout(() => {
      void refreshResults();
      interval = window.setInterval(refreshResults, 5000);
    }, 350);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); controller.abort(); };
  }, [query, token, market]);

  async function addToMyStock(result: YahooStockResult) {
    setAddingSymbol(result.symbol);
    setAddError("");
    try {
      onAdd(await addYahooStock(token, result.symbol, result.market ?? market));
    } catch (addStockError) {
      setAddError(addStockError instanceof Error ? addStockError.message : t("addStockFailed"));
    } finally {
      setAddingSymbol("");
    }
  }

  return (
    <div className="px-5 py-5">
      <h1 className="text-2xl font-black text-slate-950">{t("searchStocks")}</h1>
      <p className="mt-1 text-xs text-slate-400">{market === 'TW' ? (language === 'zh' ? 'Yahoo 台股 · 上市／上櫃 · ETF' : 'Yahoo Taiwan · TWSE / TPEx · ETFs') : t("searchHint")}</p>
      <div className="mt-4 flex items-center gap-3" aria-label={language === 'zh' ? '搜尋市場' : 'Search market'}>
        <span className={`text-xs font-semibold ${market === 'US' ? 'text-slate-900' : 'text-slate-400'}`}>{language === 'zh' ? '美股' : 'US'}</span>
        <button type="button" role="switch" aria-label={language === 'zh' ? '台股市場' : 'Taiwan market'} aria-checked={market === 'TW'} disabled={Boolean(addingSymbol)} onClick={() => {
          setMarket(market === 'US' ? 'TW' : 'US'); setQuery(''); setResults([]); setError(false); setAddError(''); setLoading(false);
        }} className={`relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 disabled:opacity-50 ${market === 'TW' ? 'bg-emerald-500' : 'bg-slate-400'}`}>
          <span className={`absolute left-1 top-1 size-6 rounded-full bg-white shadow-sm transition-transform ${market === 'TW' ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
        <span className={`text-xs font-semibold ${market === 'TW' ? 'text-slate-900' : 'text-slate-400'}`}>{language === 'zh' ? '台股' : 'Taiwan'}</span>
      </div>
      <div className="mt-5 flex h-12 items-center gap-2 rounded-md border border-slate-300 px-3 focus-within:border-slate-950">
        <Search size={18} className="text-slate-400" />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={market === 'TW' ? (language === 'zh' ? '輸入台股代號或英文名稱' : 'Taiwan symbol or English name') : t("searchPlaceholder")} className="min-w-0 flex-1 border-0 bg-transparent text-sm uppercase outline-none placeholder:normal-case" />
        {loading && <LoaderCircle size={17} className="animate-spin text-sky-600" />}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label={t("popularStocks")}>
        <span className="mr-1 text-[10px] font-semibold text-slate-400">{t("popularStocks")}</span>
        {(market === 'TW' ? TW_POPULAR_SYMBOLS : POPULAR_SYMBOLS).map((symbol) => (
          <button
            key={symbol}
            type="button"
            onClick={() => setQuery(symbol)}
            className={`h-7 min-w-12 rounded border px-2 text-[10px] font-bold transition ${query.trim().toUpperCase() === symbol ? "border-sky-600 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-700"}`}
          >
            {symbol}
          </button>
        ))}
      </div>
      {loading && <p className="mt-4 text-xs text-slate-500">{t("searching")}</p>}
      {error && <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{t("searchFailed")}</p>}
      {addError && <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{addError}</p>}
      {!loading && !error && query.trim() && !results.length && <p className="mt-4 text-sm text-slate-400">{t("noSearchResults")}</p>}
      <div className="mt-4 divide-y divide-slate-100">
        {results.map((result) => {
          const localStock = stocks.find((stock) => stock.market === (result.market ?? market) && stock.symbol.toUpperCase().replace(/\.TW$/, '') === result.symbol.replace(/\.TW$/, ''));
          const isAdding = addingSymbol === result.symbol;
          const assetLabel = { STOCK: t("assetStock"), ETF: t("assetEtf"), GOLD: t("assetGold"), BITCOIN: t("assetBitcoin") }[result.asset_type];
          const marketLabel = { PRE: t("marketPre"), REGULAR: t("marketOpen"), POST: t("marketPost"), CLOSED: t("marketClosed"), OPEN_24H: t("market24h"), UNAVAILABLE: t("priceUnavailable") }[result.market_state];
          const positive = (result.change_percent ?? 0) >= 0;
          const details = <><span className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><strong className="block text-sm text-slate-950">{result.symbol}</strong><span className="rounded bg-sky-50 px-1.5 py-0.5 text-[9px] font-bold text-sky-700">{assetLabel}</span></span>{result.price != null && <strong className="shrink-0 text-sm text-slate-950">{result.price.toLocaleString(undefined, { maximumFractionDigits: result.asset_type === "BITCOIN" ? 2 : 4 })} <small className="text-[8px] font-medium text-slate-400">{result.currency}</small></strong>}</span><span className="flex items-center justify-between gap-2"><span className="block truncate text-xs text-slate-500">{result.name}</span>{result.change_percent != null && <span className={`shrink-0 text-[10px] font-bold ${positive ? "text-emerald-600" : "text-rose-600"}`}>{positive ? "+" : ""}{result.change_percent.toFixed(2)}%</span>}</span><small className="text-[10px] text-slate-400">{result.exchange_name}{result.sector ? ` · ${result.sector}` : ""} · {marketLabel}</small></>;
          return <div key={result.symbol} className="flex w-full items-center gap-3 py-3">
            <button
              type="button"
              disabled={Boolean(localStock) || isAdding}
              onClick={() => void addToMyStock(result)}
              aria-label={localStock ? t("alreadyTracked") : `${t("addToMyStock")} ${result.symbol}`}
              title={localStock ? t("alreadyTracked") : t("addToMyStock")}
              className={`grid size-10 shrink-0 place-items-center rounded-md transition-colors ${localStock ? "bg-amber-50 text-amber-500" : "bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-500 disabled:opacity-60"}`}
            >
              {isAdding ? <LoaderCircle size={17} className="animate-spin" /> : <Star size={17} fill={localStock ? "currentColor" : "none"} />}
            </button>
            {localStock ? <button type="button" onClick={() => onOpen(localStock)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><span className="min-w-0 flex-1">{details}</span><span className="text-[10px] font-semibold text-emerald-600">{t("localStock")}</span><ChevronRight size={16} className="shrink-0 text-slate-300" /></button> : <a href={result.yahoo_url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-2 text-left"><span className="min-w-0 flex-1">{details}</span><ExternalLink size={16} className="shrink-0 text-slate-400" /></a>}
          </div>;
        })}
      </div>
    </div>
  );
}

export default function App() {
  const { t } = useLanguage();
  const [token, setToken] = useState(() => localStorage.getItem(ACCESS_KEY) ?? "");
  const [stocks, setStocks] = useState<StockPosition[]>(fallbackStocks);
  const [selectedId, setSelectedId] = useState(fallbackStocks[0].id);
  const [activeTab, setActiveTab] = useState<TabId>("stocks");
  const [liveQuote, setLiveQuote] = useState<YahooChartResponse | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) as AuthUser : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const handleExpiredSession = () => {
      localStorage.removeItem(USER_KEY);
      setAuthUser(null);
      setToken("");
    };
    window.addEventListener("pickinggeek:auth-expired", handleExpiredSession);
    return () => window.removeEventListener("pickinggeek:auth-expired", handleExpiredSession);
  }, []);

  useEffect(() => { if (token) fetchStocks(token).then((rows) => { if (rows.length) { const positions = rows.map(toPosition); setStocks(positions); setSelectedId(positions[0].id); } }).catch(() => undefined); }, [token]);
  const selected = useMemo(() => stocks.find((stock) => stock.id === selectedId) ?? stocks[0], [selectedId, stocks]);
  useEffect(() => {
    if (!token || activeTab !== "stocks") { setLiveQuote(null); return; }
    let disposed = false;
    let inFlight = false;
    setLiveQuote(null);
    const refreshQuote = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const quote = await fetchStockChart(token, selected.id, "1D");
        if (!disposed) setLiveQuote(quote);
      } catch {
        // Keep the most recent successful quote during a temporary provider error.
      } finally {
        inFlight = false;
      }
    };
    void refreshQuote();
    const timer = window.setInterval(refreshQuote, 2000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [activeTab, selected.id, token]);
  const displayStock = useMemo(() => {
    if (!liveQuote) return selected;
    const previous = liveQuote.previous_close ?? liveQuote.current_price;
    return { ...selected, currency: liveQuote.currency, currentPrice: liveQuote.current_price, changePercent: previous ? ((liveQuote.current_price - previous) / previous) * 100 : 0 };
  }, [liveQuote, selected]);
  const schema: StockAppSchema = {
    user: authUser
      ? { name: authUser.name, handle: authUser.email, avatarUrl: authUser.avatar, tier: authUser.tier }
      : { name: "Cesar Williams", handle: "cesarwilliams", tier: "PRO" },
    portfolio: { title: t("myStock"), selectedStockId: selected.id, stocks },
  };

  function handleLogin(tokens: AuthTokens) {
    localStorage.setItem(ACCESS_KEY, tokens.access);
    localStorage.setItem(REFRESH_KEY, tokens.refresh);
    if (tokens.user) {
      localStorage.setItem(USER_KEY, JSON.stringify(tokens.user));
      setAuthUser(tokens.user);
    } else {
      localStorage.removeItem(USER_KEY);
      setAuthUser(null);
    }
    setToken(tokens.access);
  }
  function logout() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    setAuthUser(null);
    setToken("");
  }
  function openStock(stock: StockPosition) { setSelectedId(stock.id); setActiveTab("stocks"); }
  function addStock(stock: StockApiResponse) {
    setStocks((current) => current.some((item) => item.id === stock.id || item.symbol.toUpperCase() === stock.symbol.toUpperCase())
      ? current
      : [...current, toPosition(stock, current.length)]);
  }
  async function removeStock(stock: StockPosition) {
    if (stocks.length <= 1) return;
    setRemovingId(stock.id);
    setRemoveError("");
    try {
      await removeTrackedStock(token, stock.id);
      const remaining = stocks.filter((item) => item.id !== stock.id);
      setStocks(remaining);
      if (selectedId === stock.id) setSelectedId(remaining[0].id);
    } catch {
      setRemoveError(t("removeStockFailed"));
    } finally {
      setRemovingId(null);
    }
  }

  if (!token) return <LoginScreen onLogin={handleLogin} />;
  return (
    <div className="min-h-[100dvh] bg-slate-100 sm:py-5">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-white sm:min-h-[calc(100dvh-2.5rem)] sm:rounded-md sm:border sm:border-slate-200 sm:shadow-xl">
        <Header user={schema.user} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          {activeTab === "stocks" && (
            <div className="space-y-4 px-4 py-4">
              <StockCard title={schema.portfolio.title} stock={displayStock} stocks={stocks} onSelect={openStock} onRemove={(stock) => void removeStock(stock)} removing={removingId === selected.id} removeError={removeError} />
              <ChartSection stock={selected} token={token} liveQuote={liveQuote} />
              <section className="rounded-md border border-slate-200 bg-white px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-950">{t("technicalIndicators")}</h2>
                  <span className="flex items-center gap-1 text-[10px] text-emerald-600"><TrendingUp size={12} />{t("liveStatus")}</span>
                </div>
                <NestedDetails nodes={selected.nestedDetails} />
              </section>
              <AIAnalysisPanel stock={selected} token={token} />
            </div>
          )}
          {activeTab === "index" && <IndexView stocks={stocks} onOpen={openStock} />}
          {activeTab === "search" && <SearchView token={token} stocks={stocks} onOpen={openStock} onAdd={addStock} />}
          {activeTab === "me" && <MeView user={schema.user} onLogout={logout} />}
        </main>
        <BottomNav active={activeTab} onChange={setActiveTab} />
      </div>
    </div>
  );
}
