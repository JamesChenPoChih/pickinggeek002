import { useEffect, useState } from 'react';
import { fetchBullishSummary, type BullishSummary } from '../../api';
import { useLanguage } from '../../i18n';

interface Props { token: string; stockKey: string }

export default function BullishSignals({ token, stockKey }: Props) {
  const { language, t } = useLanguage();
  const zh = language === 'zh';
  const [data, setData] = useState<BullishSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    setData(null); setFailed(false); setPinned(false); setHovered(false);
    const refresh = async () => {
      if (busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const next = await fetchBullishSummary(token, controller.signal);
        if (!controller.signal.aborted) { setData(next); setFailed(false); }
      } catch { if (!controller.signal.aborted) setFailed(true); }
      finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [token, stockKey]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPinned(false); setHovered(false); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  const bullish = data?.stocks.filter(stock => stock.status === 'bullish') ?? [];
  const missing = data?.stocks.filter(stock => stock.status === 'unavailable').length ?? 0;
  return <div className="relative min-w-0" onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true); }} onPointerLeave={() => setHovered(false)}>
    <button type="button" aria-label={t('bullishSignals')} aria-expanded={open} aria-describedby={open ? 'bullish-stocks-tooltip' : undefined}
      onClick={() => setPinned(value => !value)} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) setHovered(true); }} onBlur={() => { setHovered(false); setPinned(false); }}
      className="h-full w-full rounded-md bg-emerald-50 p-4 text-left text-emerald-800 focus-visible:outline-2 focus-visible:outline-emerald-600">
      <span className="block text-xs text-emerald-600">{t('bullishSignals')}</span><strong className="mt-2 block text-3xl">{data ? bullish.length : '--'}</strong>
    </button>
    {open && <div id="bullish-stocks-tooltip" role="tooltip" className="absolute right-0 top-full z-30 mt-2 max-h-[50dvh] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg">
      <strong className="block text-slate-900">{t('bullishSignals')} · {data ? bullish.length : '--'}</strong>
      {bullish.map(stock => <div key={stock.id} className="mt-2"><p className="break-words font-semibold text-slate-900">{stock.symbol} · {stock.name}</p><p className="text-[10px] text-slate-400">{stock.as_of} · {stock.score}/4</p><p className="text-[10px]">{Object.entries(stock.signals).filter(([, positive]) => positive).map(([name]) => name).join(' · ')}</p></div>)}
      {!data && <p className="mt-2">{failed ? (zh ? '技術訊號暫時無法取得' : 'Technical signals unavailable') : (zh ? '載入技術訊號中…' : 'Loading technical signals…')}</p>}
      {data && !bullish.length && <p className="mt-2">{zh ? '目前沒有符合條件的偏多股票' : 'No qualifying bullish stocks'}</p>}
      {missing > 0 && <p className="mt-2 text-[10px] text-slate-400">{zh ? `資料不足：${missing} 支（未計入）` : `Insufficient data: ${missing} (excluded)`}</p>}
      {failed && data && <p className="mt-2 text-[10px] text-slate-400">{zh ? '更新失敗，顯示最近成功結果' : 'Refresh failed; showing previous results'}</p>}
    </div>}
  </div>;
}
