import { useEffect, useMemo, useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useChartZoom } from './useChartZoom';
import { Area, ComposedChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchStockChart } from "../../api";
import { useLanguage } from "../../i18n";
import type { ChartRange, StockPosition, YahooChartResponse } from "../../types/stock";

interface ChartSectionProps { stock: StockPosition; token: string; liveQuote: YahooChartResponse | null }

const ranges: ChartRange[] = ["1D", "1W", "1M", "6M", "YTD", "1Y", "3Y", "5Y", "ALL"];
export default function ChartSection({ stock, token, liveQuote }: ChartSectionProps) {
  const { language, t } = useLanguage();
  const [range, setRange] = useState<ChartRange>("1D");
  const [chart, setChart] = useState<YahooChartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setChart(null);
    fetchStockChart(token, stock.id, range, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setChart(result); })
      .catch((chartError) => {
        if (!controller.signal.aborted && !(chartError instanceof DOMException && chartError.name === "AbortError")) setError(true);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, retryNonce, stock.id, token]);

  const activeChart = range === "1D" ? liveQuote ?? chart : chart;
  const isLoading = loading && !activeChart;
  const zoom = useChartZoom(activeChart?.points.length ?? 0, `${stock.id}:${range}`);
  const visibleChart = activeChart ? { ...activeChart, points: activeChart.points.slice(zoom.first, zoom.last) } : null;
  const zoomLabel = language === 'zh' ? ['放大', '縮小', '重設縮放'] : ['Zoom in', 'Zoom out', 'Reset zoom'];

  const formatter = useMemo(() => new Intl.DateTimeFormat(language === "zh" ? "zh-TW" : "en-US", {
    ...(range === "1D" ? { hour: "2-digit", minute: "2-digit" } : range === "1W" ? { weekday: "short", hour: "2-digit" } : ["3Y", "5Y", "ALL"].includes(range) ? { year: "2-digit", month: "short" } : { month: "short", day: "numeric" }),
    timeZone: activeChart?.timezone,
  }), [activeChart?.timezone, language, range]);

  const previous = activeChart?.previous_close ?? activeChart?.points[0]?.price ?? 0;
  const current = liveQuote?.current_price ?? activeChart?.current_price ?? 0;
  const positive = current >= previous;
  const color = positive ? "#059669" : "#e11d48";

  return (
    <section className="rounded-md border border-slate-200 bg-white px-3 pb-3 pt-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <p className="text-[10px] font-medium text-slate-400">{stock.symbol}</p>
        <div className="flex items-center gap-1">
          {[{ Icon: ZoomIn, label: zoomLabel[0], disabled: !zoom.canZoomIn, action: () => zoom.zoom(0.7) },
            { Icon: ZoomOut, label: zoomLabel[1], disabled: !zoom.canZoomOut, action: () => zoom.zoom(1 / 0.7) },
            { Icon: RotateCcw, label: zoomLabel[2], disabled: !zoom.canZoomOut, action: zoom.reset }].map(({Icon, label, disabled, action}) =>
            <button key={label} type="button" title={label} aria-label={label} disabled={disabled || !activeChart} onClick={action} className="grid size-10 place-items-center rounded text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-30"><Icon size={17} /></button>)}
        </div>
      </div>

      <div ref={zoom.priceRef} {...zoom.handlers} style={{ touchAction: activeChart ? 'none' : 'auto' }} className="h-56 w-full select-none cursor-grab active:cursor-grabbing" data-chart="price" data-visible-points={visibleChart?.points.length ?? 0} aria-label={`${stock.symbol} ${t("chartLabel")}`}>
        {isLoading && <div className="grid h-full place-items-center text-xs text-slate-400"><span className="animate-pulse">{t("chartLoading")}</span></div>}
        {!isLoading && error && !activeChart && <div className="grid h-full place-items-center px-5 text-center text-xs text-rose-600"><div><p>{t("chartUnavailable")}</p><button type="button" onClick={() => setRetryNonce((value) => value + 1)} className="mt-3 h-8 rounded border border-rose-200 bg-rose-50 px-3 text-[10px] font-bold text-rose-700">{t("chartRetry")}</button></div></div>}
        {!isLoading && activeChart && (
          <AreaChartView chart={visibleChart!} color={color} syncId={`stock-${stock.id}`} formatTimestamp={(value) => formatter.format(new Date(value * 1000))} />
        )}
      </div>
      <div className="mb-1 mt-2 grid gap-0.5 px-1" style={{ gridTemplateColumns: `repeat(${ranges.length}, minmax(0, 1fr))` }} aria-label={t("marketData")}>
        {ranges.map((item) => <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)} className={`h-6 min-w-0 rounded px-0.5 text-[9px] font-semibold transition ${range === item ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{item}</button>)}
      </div>
      {activeChart?.previous_close != null && <p className="px-1 pt-1 text-[9px] text-slate-400">{t(range === "1D" ? "previousClose" : "periodStart")}: {Number(activeChart.previous_close).toLocaleString(undefined, { maximumFractionDigits: 2 })} {activeChart.currency}</p>}
    </section>
  );
}

function AreaChartView({ chart, color, syncId, formatTimestamp }: { chart: YahooChartResponse; color: string; syncId: string; formatTimestamp: (value: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <ComposedChart data={chart.points} syncId={syncId} margin={{ top: 8, right: 8, left: -25, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#eef2f6" />
        <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={formatTimestamp} tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={28} />
        <YAxis domain={["auto", "auto"]} tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false} width={55} />
        <Tooltip labelFormatter={(value) => formatTimestamp(Number(value))} formatter={(value, name) => [Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 }), name]} contentStyle={{ border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, boxShadow: "0 8px 24px rgba(15,23,42,.08)" }} />
        <Area dataKey="price" stroke={color} fill={color} fillOpacity={0.12} strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
