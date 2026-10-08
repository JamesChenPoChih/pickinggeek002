import { useEffect, useMemo, useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useChartZoom } from './useChartZoom';
import { Area, Bar, Cell, ComposedChart, Line, ReferenceLine, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { fetchStockChart } from "../../api";
import { useLanguage } from "../../i18n";
import type { ChartRange, StockPosition, YahooChartResponse } from "../../types/stock";

interface ChartSectionProps { stock: StockPosition; token: string; liveQuote: YahooChartResponse | null }

const ranges: ChartRange[] = ["1D", "1W", "1M", "6M", "YTD", "1Y", "3Y", "5Y", "ALL"];
const averages = [
  { key: 'ma60', label: 'MA60', color: '#d97706' },
  { key: 'ma100', label: 'MA100', color: '#2563eb' },
  { key: 'ma200', label: 'MA200', color: '#9333ea' },
  { key: 'ma250', label: 'MA250', color: '#db2777' },
] as const;
type AverageKey = typeof averages[number]['key'];

export default function ChartSection({ stock, token, liveQuote }: ChartSectionProps) {
  const { language, t } = useLanguage();
  const [range, setRange] = useState<ChartRange>("1D");
  const [chart, setChart] = useState<YahooChartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [technical, setTechnical] = useState(false);
  const [selected, setSelected] = useState<AverageKey[]>(['ma60', 'ma200', 'ma250']);
  const [showMacd, setShowMacd] = useState(true);
  const visibleRanges = technical ? ranges.filter((item) => item !== '1D' && item !== '1W') : ranges;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setChart(null);
    fetchStockChart(token, stock.id, range, controller.signal, technical)
      .then((result) => { if (!controller.signal.aborted) setChart(result); })
      .catch((chartError) => {
        if (!controller.signal.aborted && !(chartError instanceof DOMException && chartError.name === "AbortError")) setError(true);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, retryNonce, stock.id, token, technical]);

  const activeChart = !technical && range === "1D" ? liveQuote ?? chart : chart;
  const isLoading = loading && !activeChart;
  const zoom = useChartZoom(activeChart?.points.length ?? 0, `${stock.id}:${range}:${technical}`);
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
          <AreaChartView chart={visibleChart!} color={color} syncId={`stock-${stock.id}`} selected={technical ? selected : []} formatTimestamp={(value) => formatter.format(new Date(value * 1000))} />
        )}
      </div>
      {technical && showMacd && activeChart && !isLoading && <div className="mt-3 border-t border-slate-100 pt-3">
        <div className="mb-1 flex flex-wrap gap-3 px-1 text-[10px] font-medium">
          <span className="text-slate-600">MACD (12, 26, 9)</span><span className="text-blue-600">DIF</span><span className="text-amber-600">DEA</span>
        </div>
        <div ref={zoom.macdRef} {...zoom.handlers} style={{ touchAction: 'none' }} className="h-32 w-full select-none cursor-grab active:cursor-grabbing" data-chart="macd" data-visible-points={visibleChart?.points.length ?? 0} aria-label="MACD">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <ComposedChart data={visibleChart!.points} syncId={`stock-${stock.id}`} margin={{ top: 8, right: 8, left: -25, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#eef2f6" />
              <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(value) => formatter.format(new Date(value * 1000))} tick={{ fontSize: 9, fill: '#94a3b8' }} minTickGap={28} axisLine={false} tickLine={false} />
              <YAxis width={55} tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip labelFormatter={(value) => formatter.format(new Date(Number(value) * 1000))} formatter={(value, name) => [Number(value).toFixed(4), name]} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
              <ReferenceLine y={0} stroke="#cbd5e1" />
              <Bar dataKey="histogram" name="Histogram" isAnimationActive={false}>
                {visibleChart!.points.map((point) => <Cell key={point.timestamp} fill={(point.histogram ?? 0) >= 0 ? '#059669' : '#e11d48'} />)}
              </Bar>
              <Line dataKey="macd" name="DIF" stroke="#2563eb" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line dataKey="macd_signal" name="DEA" stroke="#d97706" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>}
      <div className="mb-1 mt-2 grid gap-0.5 px-1" style={{ gridTemplateColumns: `repeat(${visibleRanges.length}, minmax(0, 1fr))` }} aria-label={t("marketData")}>
        {visibleRanges.map((item) => <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)} className={`h-6 min-w-0 rounded px-0.5 text-[9px] font-semibold transition ${range === item ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{item}</button>)}
      </div>
      {activeChart?.previous_close != null && <p className="px-1 pt-1 text-[9px] text-slate-400">{t(range === "1D" ? "previousClose" : "periodStart")}: {Number(activeChart.previous_close).toLocaleString(undefined, { maximumFractionDigits: 2 })} {activeChart.currency}</p>}
      <div className="mt-3 border-t border-slate-200 px-1 pt-3">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <label htmlFor="technical-chart-toggle" className="cursor-pointer text-sm font-semibold text-slate-700">{t('technicalIndicators')}{technical ? (language === 'zh' ? ' · 日線' : ' · Daily') : ''}</label>
          <button id="technical-chart-toggle" type="button" role="switch" aria-checked={technical} aria-controls="technical-chart-options" aria-label={t('technicalIndicators')} onClick={() => {
            setChart(null); setLoading(true); setError(false);
            if (!technical && (range === '1D' || range === '1W')) setRange('6M');
            setTechnical(!technical);
          }} className={`relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 ${technical ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className={`absolute left-1 top-1 size-6 rounded-full bg-white shadow-sm transition-transform ${technical ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>
        {technical && <fieldset id="technical-chart-options" aria-label={t('technicalIndicators')} className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {averages.map((average) => <label key={average.key} className="flex min-h-9 cursor-pointer items-center gap-1.5 text-xs font-semibold" style={{ color: average.color }}>
            <input type="checkbox" className="size-4" style={{ accentColor: average.color }} checked={selected.includes(average.key)} onChange={() => setSelected((values) => values.includes(average.key) ? values.filter((key) => key !== average.key) : [...values, average.key])} />
            {average.label}
          </label>)}
          <label className="flex min-h-9 cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-700"><input type="checkbox" className="size-4 accent-emerald-600" checked={showMacd} onChange={(event) => setShowMacd(event.target.checked)} />MACD</label>
          {activeChart && selected.some((key) => !activeChart.points.some((point) => point[key] != null)) && <p className="w-full text-[10px] text-slate-500">{language === 'zh' ? '部分均線的歷史資料不足' : 'Insufficient history for some averages'}</p>}
        </fieldset>}
      </div>
    </section>
  );
}

function AreaChartView({ chart, color, selected, syncId, formatTimestamp }: { chart: YahooChartResponse; color: string; selected: AverageKey[]; syncId: string; formatTimestamp: (value: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <ComposedChart data={chart.points} syncId={syncId} margin={{ top: 8, right: 8, left: -25, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#eef2f6" />
        <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={formatTimestamp} tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={28} />
        <YAxis domain={["auto", "auto"]} tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false} width={55} />
        <Tooltip labelFormatter={(value) => formatTimestamp(Number(value))} formatter={(value, name) => [Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 }), name]} contentStyle={{ border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, boxShadow: "0 8px 24px rgba(15,23,42,.08)" }} />
        <Area dataKey="price" stroke={color} fill={color} fillOpacity={0.12} strokeWidth={2} dot={false} isAnimationActive={false} />
        {averages.filter((average) => selected.includes(average.key)).map((average) => <Line key={average.key} dataKey={average.key} name={average.label} stroke={average.color} strokeWidth={1.6} dot={false} connectNulls={false} isAnimationActive={false} />)}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
