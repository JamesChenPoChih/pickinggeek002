import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, RotateCcw, Settings2, ZoomIn, ZoomOut } from 'lucide-react';
import {
  CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart,
  type IChartApi, type UTCTimestamp,
} from 'lightweight-charts';
import { fetchStockChart } from '../../api';
import { useLanguage } from '../../i18n';
import type { ChartRange, StockPosition, YahooChartResponse } from '../../types/stock';
import { averages, defaultColors, useAverageColors, type AverageKey } from './averageSettings';

type Point = YahooChartResponse['points'][number];
const periods: ChartRange[] = ['1D', '1W', '1M', '6M', '1Y', '3Y', '5Y', 'ALL'];
const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 4 });

function IndicatorHeading({ title, enabled, onToggle }: { title: string; enabled: boolean; onToggle: () => void }) {
  return <div className="flex min-h-9 items-center justify-between gap-3">
    <h2 className="min-w-0 text-xs font-bold">{title}</h2>
    <IndicatorToggle title={title} enabled={enabled} onToggle={onToggle} />
  </div>;
}

function IndicatorToggle({ title, enabled, onToggle }: { title: string; enabled: boolean; onToggle: () => void }) {
  return <button type="button" role="switch" aria-label={title} aria-checked={enabled} onClick={onToggle}
      className="flex h-11 w-12 shrink-0 items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400">
      <span aria-hidden="true" data-checked={enabled} className="app-switch-track relative h-6 w-11 rounded-full transition-colors">
        <span className={`app-switch-thumb absolute left-0.5 top-0.5 size-5 rounded-full shadow-sm transition-transform motion-reduce:transition-none ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
      </span>
    </button>;
}

export default function StockTechnicalView({ stock, token, onBack }: { stock: StockPosition; token: string; onBack: () => void }) {
  const { language } = useLanguage();
  const zh = language === 'zh';
  const [range, setRange] = useState<ChartRange>('6M');
  const [data, setData] = useState<YahooChartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [indicators, setIndicators] = useState({ ma: true, macd: true, bollinger: true, squeeze: true });
  const [selectedAverages, setSelectedAverages] = useState<AverageKey[]>(['ma60', 'ma200', 'ma250']);
  const [colors, setColors] = useAverageColors();
  const [colorSettings, setColorSettings] = useState(false);
  const [hover, setHover] = useState<Point | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false); setData(null); setHover(null);
    fetchStockChart(token, stock.id, range, controller.signal, true)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [stock.id, token, range, retry]);

  useEffect(() => {
    if (!host.current || !data?.points.length) return;
    const points = data.points;
    const api = createChart(host.current, {
      autoSize: true,
      layout: { fontSize: 10, attributionLogo: true, panes: { enableResize: false } },
      rightPriceScale: { minimumWidth: 65 },
      timeScale: { timeVisible: data.interval === '5m' || data.interval === '30m', borderVisible: false },
      localization: { locale: zh ? 'zh-TW' : 'en-US' },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });
    chart.current = api;
    const applyTheme = () => {
      const mode = document.documentElement.dataset.theme;
      const dark = mode === 'dark' || ((!mode || mode === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
      api.applyOptions({
        layout: { background: { type: ColorType.Solid, color: dark ? '#191d1f' : '#ffffff' }, textColor: dark ? '#e5e7eb' : '#475569' },
        grid: { vertLines: { color: dark ? '#292e32' : '#f1f5f9' }, horzLines: { color: dark ? '#292e32' : '#f1f5f9' } },
      });
    };
    applyTheme();
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', applyTheme);
    const time = (p: Point) => p.timestamp as UTCTimestamp;
    const candles = api.addSeries(CandlestickSeries, {
      upColor: '#059669', downColor: '#e11d48', wickUpColor: '#059669', wickDownColor: '#e11d48', borderVisible: false,
      lastValueVisible: false, priceLineVisible: false,
    });
    candles.setData(points.flatMap(p => p.open != null && p.high != null && p.low != null && p.close != null
      ? [{ time: time(p), open: p.open, high: p.high, low: p.low, close: p.close }] : [{ time: time(p) }]));
    const line = (key: keyof Point, color: string, pane = 0, title = '', dashed = false) => {
      const series = api.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: dashed ? 2 : 0, title,
        lastValueVisible: false, priceLineVisible: false, pointMarkersVisible: points.length < 6 }, pane);
      series.setData(points.map(p => typeof p[key] === 'number' ? { time: time(p), value: p[key] as number } : { time: time(p) }));
    };
    if (indicators.ma) {
      averages.filter(average => selectedAverages.includes(average.key)).forEach(average => line(average.key, colors[average.key], 0, average.label));
    }
    if (indicators.bollinger) {
      line('bb_upper', '#0d9488'); line('bb_middle', '#64748b'); line('bb_lower', '#0d9488');
    }
    if (indicators.squeeze) {
      line('kc_upper', '#d97706', 0, '', true); line('kc_lower', '#d97706', 0, '', true);
    }
    let pane = 1;
    if (indicators.macd) {
      const histogram = api.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, pane);
      histogram.setData(points.map(p => p.histogram == null ? { time: time(p) }
        : { time: time(p), value: p.histogram, color: p.histogram >= 0 ? '#059669' : '#e11d48' }));
      histogram.createPriceLine({ price: 0, color: '#94a3b8', lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
      line('macd', '#2563eb', pane, 'DIF'); line('macd_signal', '#d97706', pane, 'DEA');
      pane += 1;
    }
    if (indicators.squeeze) {
      const momentum = api.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, pane);
      momentum.setData(points.map((p, i) => p.squeeze_momentum == null ? { time: time(p) } : {
        time: time(p), value: p.squeeze_momentum,
        color: p.squeeze_momentum >= 0 ? (p.squeeze_momentum >= (points[i - 1]?.squeeze_momentum ?? 0) ? '#10b981' : '#047857')
          : (p.squeeze_momentum <= (points[i - 1]?.squeeze_momentum ?? 0) ? '#f43f5e' : '#be123c'),
      }));
      const dots = api.addSeries(LineSeries, { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 3,
        lastValueVisible: false, priceLineVisible: false }, pane);
      dots.setData(points.map(p => p.squeeze_state == null ? { time: time(p) } : {
        time: time(p), value: 0, color: p.squeeze_state === 'ON' ? '#111827' : p.squeeze_state === 'OFF' ? '#10b981' : '#94a3b8',
      }));
    }
    api.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 2 : 1));
    api.timeScale().fitContent();
    const byTime = new Map(points.map(p => [p.timestamp, p]));
    api.subscribeCrosshairMove(event => setHover(typeof event.time === 'number' ? byTime.get(event.time) ?? null : null));
    return () => { observer.disconnect(); media.removeEventListener('change', applyTheme); api.remove(); chart.current = null; };
  }, [data, indicators, selectedAverages, colors, zh]);

  const selected = hover ?? data?.points.at(-1);
  const squeeze = selected?.squeeze_state;
  const squeezeLabel = squeeze === 'ON' ? (zh ? '擠壓中' : 'Squeeze on') : squeeze === 'OFF' ? (zh ? '擠壓解除' : 'Squeeze off') : squeeze === 'NEUTRAL' ? (zh ? '中性' : 'Neutral') : '—';
  const candlesMissing = !!data?.points.length && !data.points.some(p => p.open != null && p.high != null && p.low != null && p.close != null);
  function zoom(factor: number) {
    const scale = chart.current?.timeScale(); const visible = scale?.getVisibleLogicalRange();
    if (!scale || !visible) return;
    const middle = (visible.from + visible.to) / 2;
    const size = Math.max(10, (visible.to - visible.from) * factor);
    scale.setVisibleLogicalRange({ from: middle - size / 2, to: middle + size / 2 });
  }
  const height = 300 + (indicators.macd ? 135 : 0) + (indicators.squeeze ? 135 : 0);
  return <div data-stock-technical className="pb-5 text-slate-900">
    <div className="flex min-h-14 items-center gap-2 border-b border-slate-200 px-3">
      <button type="button" onClick={onBack} title={zh ? '返回 My Stock' : 'Back to My Stock'} aria-label={zh ? '返回 My Stock' : 'Back to My Stock'} className="grid size-10 shrink-0 place-items-center rounded hover:bg-slate-100"><ArrowLeft size={18} /></button>
      <div className="min-w-0"><h1 className="truncate text-sm font-bold">{stock.symbol} · {stock.name}</h1><p className="text-[10px] text-slate-500">{zh ? '技術分析' : 'Technical analysis'} · {range === '1D' ? (zh ? '5 分鐘 K' : '5-minute candles') : range === '1W' ? (zh ? '30 分鐘 K' : '30-minute candles') : (zh ? '日 K' : 'Daily')} · {data?.currency ?? stock.currency}</p></div>
    </div>
    <div className="px-3 pt-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="grid w-full grid-cols-8 gap-1">{periods.map(period => <button key={period} type="button" aria-pressed={range === period} onClick={() => setRange(period)} className={`h-8 min-w-0 rounded font-semibold ${range === period ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700'}`}><span className="text-[10px]">{period}</span></button>)}</div>
        <div className="flex shrink-0">{[{ Icon: ZoomIn, name: zh ? '放大 K 線' : 'Zoom in candles', action: () => zoom(0.7) }, { Icon: ZoomOut, name: zh ? '縮小 K 線' : 'Zoom out candles', action: () => zoom(1 / 0.7) }, { Icon: RotateCcw, name: zh ? '重設 K 線' : 'Reset candles', action: () => chart.current?.timeScale().fitContent() }].map(({ Icon, name, action }) => <button key={name} type="button" title={name} aria-label={name} onClick={action} disabled={!data || candlesMissing} className="grid size-8 place-items-center rounded hover:bg-slate-100 disabled:opacity-30"><Icon size={15} /></button>)}</div>
      </div>
      <fieldset className="my-3 flex flex-wrap gap-x-4 gap-y-1" aria-label={zh ? '技術指標' : 'Technical indicators'}>{([{ key: 'ma', label: 'MA' }, { key: 'macd', label: 'MACD' }, { key: 'bollinger', label: 'Bollinger Bands' }, { key: 'squeeze', label: 'Squeeze' }] as const).map(({ key, label }) => <label key={key} className="flex min-h-9 cursor-pointer items-center gap-2 text-xs font-semibold"><input type="checkbox" className="size-4 accent-emerald-600" checked={indicators[key]} onChange={e => setIndicators(v => ({ ...v, [key]: e.target.checked }))} />{label}</label>)}</fieldset>
      <div className="min-h-12 text-[10px] leading-5 text-slate-600">
        <p>{selected ? new Intl.DateTimeFormat(zh ? 'zh-TW' : 'en-US', { timeZone: data?.timezone }).format(new Date(selected.timestamp * 1000)) : '—'}</p>
        <p>{zh ? '開' : 'O'} {number(selected?.open)} · {zh ? '高' : 'H'} {number(selected?.high)} · {zh ? '低' : 'L'} {number(selected?.low)} · {zh ? '收' : 'C'} {number(selected?.close)}</p>
      </div>
      <div className="relative mt-1" style={{ height }}>
        <div ref={host} data-chart="technical-candles" data-points={data?.points.length ?? 0} data-ma={indicators.ma ? selectedAverages.join(',') : ''} className="h-full w-full" role="img" aria-label={`${stock.symbol} ${zh ? 'K 線與技術指標' : 'candlestick and technical indicators'}`} />
        {(loading || error || candlesMissing || (data && !data.points.length)) && <div className="absolute inset-0 grid place-items-center bg-white px-5 text-center text-xs text-slate-600" role="status"><div>{loading ? (zh ? '載入行情中…' : 'Loading market data…') : (zh ? '暫無完整 K 線行情' : 'Complete candle data is unavailable')}{!loading && <button type="button" onClick={() => setRetry(v => v + 1)} className="mx-auto mt-3 block min-h-9 rounded border border-slate-300 px-4">{zh ? '重試' : 'Try again'}</button>}</div></div>}
      </div>
      <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
      <section className="py-3" data-ma-settings>
        <h2 className="text-xs font-bold">MA</h2>
        <div className="flex items-center gap-1"><fieldset disabled={!indicators.ma} aria-label={zh ? 'MA 均線週期' : 'MA periods'} className="flex min-w-0 flex-1 flex-wrap gap-x-2 gap-y-1 disabled:opacity-40">
          {averages.map(average => <label key={average.key} className="flex min-h-9 cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] font-semibold"><input type="checkbox" className="size-3 accent-emerald-600" checked={selectedAverages.includes(average.key)} onChange={() => setSelectedAverages(values => values.includes(average.key) ? values.filter(key => key !== average.key) : [...values, average.key])} />{average.label}</label>)}
        </fieldset><button type="button" disabled={!indicators.ma} aria-label={zh ? '指標顏色設定' : 'Indicator colors'} title={zh ? '指標顏色設定' : 'Indicator colors'} aria-expanded={indicators.ma && colorSettings} aria-controls="candle-average-colors" onClick={() => setColorSettings(value => !value)} className="grid size-9 shrink-0 place-items-center rounded hover:bg-slate-100 disabled:opacity-40"><Settings2 size={17} /></button><IndicatorToggle title="MA" enabled={indicators.ma} onToggle={() => setIndicators(value => ({ ...value, ma: !value.ma }))} /></div>
        {indicators.ma && data && selectedAverages.some(key => !data.points.some(point => point[key] != null)) && <p className="text-[10px] text-slate-500">{zh ? '部分均線的歷史資料不足' : 'Insufficient history for some averages'}</p>}
        {indicators.ma && colorSettings && <fieldset id="candle-average-colors" className="mt-2 border-t border-slate-200 pt-2"><legend className="px-1 text-xs font-semibold">{zh ? '均線顏色' : 'Moving average colors'}</legend><div className="grid grid-cols-2 gap-x-5 gap-y-2">
          {averages.map(average => <label key={average.key} className="flex min-h-10 items-center justify-between gap-2 text-xs font-semibold">{average.label}<input type="color" aria-label={`${average.label} ${zh ? '線條顏色' : 'line color'}`} value={colors[average.key]} onChange={event => setColors(previous => ({ ...previous, [average.key]: event.target.value }))} className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5" /></label>)}
        </div><button type="button" onClick={() => setColors({ ...defaultColors })} className="mt-2 flex min-h-9 items-center gap-1.5 text-xs font-medium hover:underline"><RotateCcw size={13} />{zh ? '恢復預設顏色' : 'Reset colors'}</button></fieldset>}
      </section>
        <section className="py-3"><IndicatorHeading title="MACD (12, 26, 9)" enabled={indicators.macd} onToggle={() => setIndicators(v => ({ ...v, macd: !v.macd }))} />{indicators.macd && <p className="mt-1 text-xs leading-6">DIF {number(selected?.macd)} · DEA {number(selected?.macd_signal)}<br />Histogram {number(selected?.histogram)} · {selected?.macd_cross === 'BULLISH' ? (zh ? '金叉：柱狀圖由負轉正' : 'Bullish: histogram turned positive') : selected?.macd_cross === 'BEARISH' ? (zh ? '死叉：柱狀圖由正轉負' : 'Bearish: histogram turned negative') : selected?.histogram == null ? (zh ? '歷史資料不足' : 'Insufficient history') : (zh ? '本日無零軸穿越' : 'No zero crossing on this day')}</p>}</section>
        <section className="py-3"><IndicatorHeading title={`${zh ? '布林通道' : 'Bollinger Bands'} (20, 2σ)`} enabled={indicators.bollinger} onToggle={() => setIndicators(v => ({ ...v, bollinger: !v.bollinger }))} />{indicators.bollinger && <p className="mt-1 text-xs leading-6">{zh ? '上／中／下軌' : 'Upper / Middle / Lower'} {number(selected?.bb_upper)} / {number(selected?.bb_middle)} / {number(selected?.bb_lower)}<br />Bandwidth {selected?.bb_bandwidth == null ? '—' : `${(selected.bb_bandwidth * 100).toFixed(2)}%`} · {selected?.bb_upper == null || selected?.bb_lower == null ? (zh ? '歷史資料不足' : 'Insufficient history') : selected.price > selected.bb_upper ? (zh ? '收盤超越上軌' : 'Close above upper band') : selected.price < selected.bb_lower ? (zh ? '收盤跌破下軌' : 'Close below lower band') : (zh ? '收盤位於通道內' : 'Close inside bands')}</p>}</section>
        <section className="py-3"><IndicatorHeading title={`${zh ? '擠壓指標' : 'Squeeze Momentum'} · BB(20, 2) / KC(20, 1.5)`} enabled={indicators.squeeze} onToggle={() => setIndicators(v => ({ ...v, squeeze: !v.squeeze }))} />{indicators.squeeze && <><p className="mt-1 flex items-center gap-2 text-xs"><span className={`size-2.5 shrink-0 rounded-full ${squeeze === 'ON' ? 'border border-slate-400 bg-black' : squeeze === 'OFF' ? 'bg-emerald-500' : 'bg-slate-400'}`} />{squeezeLabel}{selected?.squeeze_released ? (zh ? ' · 本日解除擠壓' : ' · Released today') : ''}</p><p className="mt-1 text-xs leading-6">Momentum {number(selected?.squeeze_momentum)}<br />{zh ? '黑點：擠壓中 · 綠點：解除 · 灰點：中性' : 'Black: on · Green: off · Gray: neutral'}</p></>}</section>
      </div>
    </div>
  </div>;
}
