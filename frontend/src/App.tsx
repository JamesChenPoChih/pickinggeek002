import { useEffect, useMemo, useRef, useState } from "react";
import { BellPlus, ChevronRight, ExternalLink, LoaderCircle, LockKeyhole, Search, Star } from "lucide-react";

import { addYahooStock, fetchStockChart, fetchStocks, removeTrackedStock, searchYahooStocks, type AuthTokens, type AuthUser } from "./api";
import { AIAnalysisPanel, type AnalysisRecord } from "./components/mobile/AIAnalysisPanel";
import type { HistorySelection } from './components/mobile/TodayAnalysis';
import BullishSignals from './components/mobile/BullishSignals';
import StockWheelPicker from './components/mobile/StockWheelPicker';
import BottomNav, { type TabId } from "./components/mobile/BottomNav";
import ChartSection from "./components/mobile/ChartSection";
import Header from "./components/mobile/Header";
import { LoginScreen } from "./components/mobile/LoginScreen";
import MeView from "./components/mobile/MeView";
import StockTechnicalView from "./components/mobile/StockTechnicalView";
import AlertDialog from './components/mobile/AlertDialog';
import StockCard from "./components/mobile/StockCard";
import type { ChartPoint, DetailNode, StockApiResponse, StockAppSchema, StockPosition, YahooChartResponse, YahooStockResult } from "./types/stock";
import { useLanguage } from "./i18n";
import { billingRequest, type BillingState } from "./api";

const ACCESS_KEY = "pickinggeek_access";
const REFRESH_KEY = "pickinggeek_refresh";
const USER_KEY = "pickinggeek_user";
const US_RECOMMENDED_STOCKS: YahooStockResult[] = [
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", asset_type: "ETF" },
  { symbol: "QQQ", name: "Invesco QQQ Trust", asset_type: "ETF" },
  { symbol: "SMH", name: "VanEck Semiconductor ETF", asset_type: "ETF" },
  { symbol: "NVDA", name: "NVIDIA", asset_type: "STOCK" },
  { symbol: "NBIS", name: "Nebius Group", asset_type: "STOCK" },
].map((stock): YahooStockResult => ({
  ...stock, asset_type: stock.asset_type as "ETF" | "STOCK", market: "US", currency: "USD",
  exchange: "", exchange_name: "", sector: "", yahoo_url: `https://finance.yahoo.com/quote/${stock.symbol}/`,
  price: null, change_percent: null, market_state: "UNAVAILABLE", updated_at: null,
}));
const TW_RECOMMENDED_STOCKS: YahooStockResult[] = [
  { symbol: "2330", name: "台積電", asset_type: "STOCK" },
  { symbol: "0050", name: "元大台灣50", asset_type: "ETF" },
  { symbol: "2454", name: "聯發科", asset_type: "STOCK" },
  { symbol: "2317", name: "鴻海", asset_type: "STOCK" },
  { symbol: "2308", name: "台達電", asset_type: "STOCK" },
].map((stock): YahooStockResult => ({
  ...stock, asset_type: stock.asset_type as "ETF" | "STOCK", market: "TW", currency: "TWD",
  exchange: "", exchange_name: "", sector: "", yahoo_url: `https://tw.stock.yahoo.com/quote/${stock.symbol}.TW`,
  price: null, change_percent: null, market_state: "UNAVAILABLE", updated_at: null,
}));

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
  return { ...stock, alertEnabled: !!stock.alert_enabled, currentPrice: latest, changePercent: previous ? ((latest - previous) / previous) * 100 : 0, chartData, nestedDetails: detailNodes(stock) };
}

const fallbackStocks: StockPosition[] = [
  { id: 1, symbol: "NVDA", market: "US", name: "Nvidia", currency: "USD", currentPrice: 228.5, changePercent: 1.82, indicator: null, chartData: makeChart(228.5), nestedDetails: [{ id: "macd", label: "MACD", value: "BULLISH", tone: "positive" }, { id: "ma", label: "均線訊號", children: [{ id: "ma60", label: "MA60", value: "站上", tone: "positive" }, { id: "ma200", label: "MA200", value: "站上", tone: "positive" }] }] },
  { id: 2, symbol: "AAPL", market: "US", name: "Apple", currency: "USD", currentPrice: 198.72, changePercent: -0.36, indicator: null, chartData: makeChart(198.72, 5), nestedDetails: [{ id: "macd", label: "MACD", value: "NEUTRAL", tone: "neutral" }] },
  { id: 3, symbol: "2330", market: "TW", name: "台積電", currency: "TWD", currentPrice: 1045, changePercent: 1.46, indicator: null, chartData: makeChart(1045, 9), nestedDetails: [{ id: "macd", label: "MACD", value: "BULLISH", tone: "positive" }] },
];

function MarketSnapshot({ stocks, token, overviewOnly = false }: { stocks: StockPosition[]; token: string; overviewOnly?: boolean }) {
  const [technicalId, setTechnicalId] = useState<number | null>(null);
  const [alertStockId, setAlertStockId] = useState<number | null>(null);
  const [alertSaved, setAlertSaved] = useState(false);
  const [quotes, setQuotes] = useState<Record<number, { chart: YahooChartResponse | null; failed: boolean }>>({});
  const onOpen = (stock: StockPosition) => setTechnicalId(stock.id);
  const { t, language } = useLanguage();
  const orderedStocks = useMemo(() => [...stocks].sort((a, b) => a.market !== b.market
    ? (a.market === 'US' ? -1 : 1) : a.symbol.localeCompare(b.symbol, 'en', { numeric: true })), [stocks]);
  useEffect(() => {
    if (!token || technicalId !== null || overviewOnly) return;
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      let next = 0;
      const worker = async () => {
        while (next < stocks.length && !controller.signal.aborted) {
          const stock = stocks[next++];
          try {
            const chart = await fetchStockChart(token, stock.id, '1D', controller.signal);
            if (!Number.isFinite(chart.current_price)) throw new Error('Missing market price');
            if (!controller.signal.aborted) setQuotes(current => ({ ...current, [stock.id]: { chart, failed: false } }));
          } catch {
            if (!controller.signal.aborted) setQuotes(current => ({ ...current, [stock.id]: { chart: current[stock.id]?.chart ?? null, failed: true } }));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, stocks.length) }, worker));
      inFlight = false;
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [stocks, token, technicalId, overviewOnly]);
  const technicalStock = stocks.find(stock => stock.id === technicalId);
  if (technicalStock) return <StockTechnicalView stock={technicalStock} token={token} onBack={() => setTechnicalId(null)} />;
  const changeFor = (quote: YahooChartResponse | null | undefined) => quote?.previous_close && Number.isFinite(quote.previous_close)
    ? (quote.current_price - quote.previous_close) / quote.previous_close * 100 : null;
  return <section className={overviewOnly ? "px-5 py-5" : "border-y border-slate-200 py-3"}>
    {alertStockId !== null && stocks.find(stock => stock.id === alertStockId) && <AlertDialog stock={stocks.find(stock => stock.id === alertStockId)!} onClose={() => setAlertStockId(null)} onSaved={() => { setAlertStockId(null); setAlertSaved(true); }} />}
    {alertSaved && <p role="status" className="mb-3 text-xs text-emerald-600">{language === 'zh' ? '警示設定已儲存' : 'Alert settings saved'}</p>}
    {overviewOnly && <><div className="mb-5"><p className="text-xs font-semibold text-sky-700">{t("brandName")}</p><h1 className="mt-1 text-2xl font-black text-slate-950">{t("todayMarket")}</h1></div>
    <div className="grid grid-cols-2 gap-3"><div className="rounded-md bg-slate-950 p-4 text-white"><p className="text-xs text-slate-400">{t("trackedAssets")}</p><strong className="mt-2 block text-3xl">{stocks.length}</strong></div><BullishSignals token={token} stockKey={stocks.map(stock => stock.id).join(',')} /></div>
    </>}
    {!overviewOnly && <><h2 className="mb-2 text-base font-bold text-slate-950">{t("marketSnapshot")}</h2>
    <div className="stock-snapshot-list">{orderedStocks.map(stock => {
      const state = quotes[stock.id];
      const quote = state?.chart;
      const change = changeFor(quote);
      return <div key={stock.id} className="flex items-center gap-2"><button type="button" onClick={() => onOpen(stock)} data-stock-quote={stock.symbol} title={state?.failed ? (language === 'zh' ? '行情暫時無法更新' : 'Quote update unavailable') : undefined} className="flex min-w-0 flex-1 items-center gap-3 py-4 text-left">
        <span className="min-w-0 flex-1"><strong className="block text-[16px] text-slate-900">{stock.symbol}</strong><span className="block break-words text-[11px] text-slate-400">{stock.name}</span></span>
        <span className="shrink-0 text-right"><strong className="flex items-baseline justify-end gap-1 text-[12px] text-slate-900"><span>{quote ? quote.current_price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '--'}</span><span data-quote-currency className="text-[6px] font-normal text-slate-400">{quote?.currency ?? stock.currency}</span></strong>
          <span className={`block text-[12px] font-bold ${change == null ? 'text-slate-400' : change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{change == null ? '--' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}</span>
        </span>
      </button><button type="button" onClick={() => { setAlertSaved(false); setAlertStockId(stock.id); }} aria-label={`Set Alert ${stock.symbol}`} aria-description={stock.alertEnabled ? (language === 'zh' ? '警示已啟用' : 'Alerts enabled') : (language === 'zh' ? '警示未啟用' : 'Alerts not enabled')} title={`${stock.symbol} · ${stock.alertEnabled ? (language === 'zh' ? '警示已啟用' : 'Alerts enabled') : (language === 'zh' ? '設定警示' : 'Set Alert')}`} data-alert-enabled={!!stock.alertEnabled} className={`grid size-11 shrink-0 place-items-center rounded hover:bg-slate-100 ${stock.alertEnabled ? 'text-slate-900' : 'text-slate-400'}`}><BellPlus size={18} strokeWidth={stock.alertEnabled ? 2.8 : 1.5} /></button></div>;
    })}</div></>}
  </section>;
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

  const showingRecommendations = !query.trim();
  const recommendedStocks = market === 'TW' ? TW_RECOMMENDED_STOCKS : US_RECOMMENDED_STOCKS;
  const visibleResults = showingRecommendations ? recommendedStocks : results;
  const shortcuts = market === 'TW' ? TW_RECOMMENDED_STOCKS.map(stock => stock.symbol) : [...US_RECOMMENDED_STOCKS.map(stock => stock.symbol), 'BTC-USD'];

  return (
    <div className="px-5 py-5">
      <h1 className="text-2xl font-black text-slate-950">{t("searchStocks")}</h1>
      <p className="mt-1 text-xs text-slate-400">{market === 'TW' ? (language === 'zh' ? 'Yahoo 台股 · 上市／上櫃 · ETF' : 'Yahoo Taiwan · TWSE / TPEx · ETFs') : t("searchHint")}</p>
      <div className="mt-4 flex items-center gap-3" aria-label={language === 'zh' ? '搜尋市場' : 'Search market'}>
        <span className={`text-xs font-semibold ${market === 'US' ? 'text-slate-900' : 'text-slate-400'}`}>{language === 'zh' ? '美股' : 'US'}</span>
        <button type="button" role="switch" aria-label={language === 'zh' ? '台股市場' : 'Taiwan market'} aria-checked={market === 'TW'} disabled={Boolean(addingSymbol)} onClick={() => {
          setMarket(market === 'US' ? 'TW' : 'US'); setQuery(''); setResults([]); setError(false); setAddError(''); setLoading(false);
        }} data-checked={market === 'TW'} className="app-switch-track relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-400 disabled:opacity-50">
          <span className={`app-switch-thumb absolute left-1 top-1 size-6 rounded-full shadow-sm transition-transform motion-reduce:transition-none ${market === 'TW' ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
        <span className={`text-xs font-semibold ${market === 'TW' ? 'text-slate-900' : 'text-slate-400'}`}>{language === 'zh' ? '台股' : 'Taiwan'}</span>
      </div>
      <div className="mt-5 flex h-12 items-center gap-2 rounded-md border border-slate-300 px-3 focus-within:border-slate-950">
        <Search size={18} className="text-slate-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={market === 'TW' ? (language === 'zh' ? '輸入台股代號、中文或英文名稱' : 'Taiwan symbol, Chinese or English name') : t("searchPlaceholder")} className="min-w-0 flex-1 border-0 bg-transparent text-sm uppercase outline-none placeholder:normal-case" />
        {loading && <LoaderCircle size={17} className="animate-spin text-sky-600" />}
      </div>
      <div className="mt-3" aria-label={t("popularStocks")}>
        <span className="block text-[10px] font-semibold text-slate-400">{t("popularStocks")}</span>
        <div className={`mt-2 grid gap-1 ${market === 'TW' ? 'grid-cols-5' : 'grid-cols-6'}`}>{shortcuts.map((symbol) => (
          <button
            key={symbol}
            type="button"
            onClick={() => setQuery(symbol)}
            className={`h-7 min-w-0 rounded border px-1 text-[10px] font-bold transition ${query.trim().toUpperCase() === symbol ? "border-sky-600 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-700"}`}
          >
            <span className="text-[10px]">{symbol === 'BTC-USD' ? 'Bitcoin' : symbol}</span>
          </button>
        ))}</div>
      </div>
      {loading && <p className="mt-4 text-xs text-slate-500">{t("searching")}</p>}
      {error && <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{t("searchFailed")}</p>}
      {addError && <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{addError}</p>}
      {!loading && !error && query.trim() && !results.length && <p className="mt-4 text-sm text-slate-400">{t("noSearchResults")}</p>}
      <div className="stock-search-list mt-4">
        {visibleResults.map((result) => {
          const localStock = stocks.find((stock) => stock.market === (result.market ?? market) && stock.symbol.toUpperCase().replace(/\.TW$/, '') === result.symbol.replace(/\.TW$/, ''));
          const isAdding = addingSymbol === result.symbol;
          const assetLabel = { STOCK: t("assetStock"), ETF: t("assetEtf"), GOLD: t("assetGold"), BITCOIN: t("assetBitcoin") }[result.asset_type];
          const marketLabel = { PRE: t("marketPre"), REGULAR: t("marketOpen"), POST: t("marketPost"), CLOSED: t("marketClosed"), OPEN_24H: t("market24h"), UNAVAILABLE: t("priceUnavailable") }[result.market_state];
          const positive = (result.change_percent ?? 0) >= 0;
          const muted = showingRecommendations && !localStock;
          const details = <><span className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><strong className={`block text-sm ${muted ? "text-slate-400" : "text-slate-950"}`}>{result.symbol}</strong><span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${muted ? "bg-slate-100 text-slate-400" : "bg-sky-50 text-sky-700"}`}>{assetLabel}</span></span>{result.price != null && <strong className="shrink-0 text-sm text-slate-950">{result.price.toLocaleString(undefined, { maximumFractionDigits: result.asset_type === "BITCOIN" ? 2 : 4 })} <small className="text-[8px] font-medium text-slate-400">{result.currency}</small></strong>}</span><span className="flex items-center justify-between gap-2"><span className={`block truncate text-xs ${muted ? "text-slate-400" : "text-slate-500"}`}>{result.name}</span>{result.change_percent != null && <span className={`shrink-0 text-[10px] font-bold ${positive ? "text-emerald-600" : "text-rose-600"}`}>{positive ? "+" : ""}{result.change_percent.toFixed(2)}%</span>}</span>{!showingRecommendations && <small className="text-[10px] text-slate-400">{result.exchange_name}{result.sector ? ` · ${result.sector}` : ""} · {marketLabel}</small>}</>;
          return <div key={result.symbol} className="flex w-full items-center gap-3 py-3">
            <button
              type="button"
              disabled={Boolean(localStock) || Boolean(addingSymbol)}
              onClick={() => void addToMyStock(result)}
              aria-label={localStock ? t("alreadyTracked") : `${t("addToMyStock")} ${result.symbol}`}
              title={localStock ? t("alreadyTracked") : t("addToMyStock")}
              className={`grid size-10 shrink-0 place-items-center rounded-md transition-colors ${localStock ? "bg-amber-50 text-amber-500" : `bg-slate-100 ${muted ? "text-slate-400" : "text-slate-600"} hover:bg-amber-50 hover:text-amber-500 disabled:opacity-60`}`}
            >
              {isAdding ? <LoaderCircle size={17} className="animate-spin" /> : <Star size={17} fill={localStock ? "currentColor" : "none"} />}
            </button>
            {localStock ? <button type="button" onClick={() => onOpen(localStock)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><span className="min-w-0 flex-1">{details}</span><ChevronRight size={16} className="shrink-0 text-slate-300" /></button> : <a href={result.yahoo_url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-2 text-left"><span className="min-w-0 flex-1">{details}</span><ExternalLink size={16} className="shrink-0 text-slate-400" /></a>}
          </div>;
        })}
      </div>
    </div>
  );
}

export default function App() {
  const { t, language } = useLanguage();
  const [token, setToken] = useState(() => localStorage.getItem(ACCESS_KEY) ?? "");
  const analysisHistory = useRef<Record<string, AnalysisRecord[]>>({});
  const [analysisSelection, setAnalysisSelection] = useState<HistorySelection | null>(null);
  useEffect(() => { setAnalysisSelection(null); }, [language]);
  const [stocks, setStocks] = useState<StockPosition[]>(fallbackStocks);
  useEffect(() => {
    const saved = (event: Event) => {
      const detail = (event as CustomEvent<{ stockId: number; enabled: boolean }>).detail;
      if (!detail || typeof detail.stockId !== 'number' || typeof detail.enabled !== 'boolean') return;
      setStocks(current => current.map(stock => stock.id === detail.stockId ? { ...stock, alertEnabled: detail.enabled } : stock));
    };
    const sync = (event: Event) => {
      const ids = (event as CustomEvent<number[]>).detail;
      if (!Array.isArray(ids)) return;
      setStocks(current => {
        let changed = false;
        const next = current.map(stock => {
          const enabled = ids.includes(stock.id);
          if (!!stock.alertEnabled === enabled) return stock;
          changed = true;
          return { ...stock, alertEnabled: enabled };
        });
        return changed ? next : current;
      });
    };
    window.addEventListener('pickinggeek:alerts-updated', saved);
    window.addEventListener('pickinggeek:alert-status', sync);
    return () => { window.removeEventListener('pickinggeek:alerts-updated', saved); window.removeEventListener('pickinggeek:alert-status', sync); };
  }, []);
  const [selectedId, setSelectedId] = useState(fallbackStocks[0].id);
  const [activeTab, setActiveTab] = useState<TabId>(() => new URLSearchParams(window.location.search).has("billing") ? "me" : "stocks");
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
      analysisHistory.current = {};
      setAnalysisSelection(null);
      localStorage.removeItem(USER_KEY);
      setAuthUser(null);
      setToken("");
    };
    window.addEventListener("pickinggeek:auth-expired", handleExpiredSession);
    return () => window.removeEventListener("pickinggeek:auth-expired", handleExpiredSession);
  }, []);

  useEffect(() => { if (token) fetchStocks(token).then((rows) => { if (rows.length) { const positions = rows.map(toPosition); setStocks(positions); setSelectedId(positions[0].id); } }).catch(() => undefined); }, [token]);
  useEffect(() => {
    if (!token) return;
    let disposed = false;
    const update = (user: AuthUser) => {
      if (disposed) return;
      setAuthUser(user);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    };
    const handleBilling = (event: Event) => update((event as CustomEvent<AuthUser>).detail);
    window.addEventListener("pickinggeek:billing-updated", handleBilling);
    void billingRequest<BillingState>().then((state) => update(state.user)).catch(() => undefined);
    return () => { disposed = true; window.removeEventListener("pickinggeek:billing-updated", handleBilling); };
  }, [token]);
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
      : { name: "Picking Geek", handle: "", tier: "FREE" },
    portfolio: { title: t("myStock"), selectedStockId: selected.id, stocks },
  };

  function handleLogin(tokens: AuthTokens) {
    analysisHistory.current = {};
    setAnalysisSelection(null);
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
    analysisHistory.current = {};
    setAnalysisSelection(null);
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
              <MarketSnapshot stocks={stocks} token={token} />
            </div>
          )}
          {activeTab === "index" && (authUser?.tier === "PRO" || authUser?.tier === "PREMIUM" ? <><MarketSnapshot stocks={stocks} token={token} overviewOnly /><div className="px-5 pb-4"><StockWheelPicker stocks={stocks} selectedId={selected.id} onSelect={id => { setSelectedId(id); setAnalysisSelection(null); }} /></div><AIAnalysisPanel stock={selected} token={token} historyStore={analysisHistory} selection={analysisSelection} onSelectHistory={item => { setSelectedId(Number(item.key.split(':')[0])); setAnalysisSelection(item); }} /></> : <section className="grid min-h-full place-items-center px-8 py-10 text-center"><div className="max-w-xs"><span className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-slate-100 text-slate-600"><LockKeyhole size={24} aria-hidden="true" /></span><h1 className="text-base font-bold text-slate-950">Sorry, Pro Model &amp; Ultra Model are available to paid members only.</h1></div></section>)}
          {activeTab === "search" && <SearchView token={token} stocks={stocks} onOpen={openStock} onAdd={addStock} />}
          {activeTab === "me" && <MeView user={schema.user} onLogout={logout} />}
        </main>
        <BottomNav active={activeTab} onChange={setActiveTab} />
      </div>
    </div>
  );
}
