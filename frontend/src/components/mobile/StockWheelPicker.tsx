import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useLanguage } from '../../i18n';
import type { StockPosition } from '../../types/stock';

const ROW_HEIGHT = 64;

export default function StockWheelPicker({ stocks, selectedId, onSelect }: {
  stocks: StockPosition[]; selectedId: number; onSelect: (id: number) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const sorted = useMemo(() => [...stocks].sort((a, b) => {
    if (a.market !== b.market) return a.market === 'US' ? -1 : 1;
    return a.symbol.localeCompare(b.symbol, 'en', { numeric: true, sensitivity: 'base' }) || a.name.localeCompare(b.name, 'zh-TW');
  }), [stocks]);
  const selected = stocks.find(stock => stock.id === selectedId);
  return <>
    <button type="button" aria-label={t('selectStock')} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded border border-slate-300 bg-white px-3 py-2 text-left text-sm font-bold text-slate-900">
      <span className="min-w-0 break-words">{selected?.symbol} · {selected?.name}</span><ChevronsUpDown size={16} className="shrink-0" />
    </button>
    {open && <WheelDialog stocks={sorted} selectedId={selectedId} onClose={() => setOpen(false)} onSelect={id => { onSelect(id); setOpen(false); }} />}
  </>;
}

function WheelDialog({ stocks, selectedId, onClose, onSelect }: {
  stocks: StockPosition[]; selectedId: number; onClose: () => void; onSelect: (id: number) => void;
}) {
  const { t, language } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const wheel = useRef<HTMLDivElement>(null);
  const id = useId();
  const [index, setIndex] = useState(Math.max(0, stocks.findIndex(stock => stock.id === selectedId)));
  const clamp = (value: number) => Math.max(0, Math.min(stocks.length - 1, value));
  useEffect(() => {
    dialog.current?.showModal();
    if (wheel.current) { wheel.current.scrollTop = index * ROW_HEIGHT; wheel.current.focus(); }
  }, []);
  function move(next: number) {
    const target = clamp(next);
    setIndex(target);
    wheel.current?.scrollTo({ top: target * ROW_HEIGHT, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  return <dialog ref={dialog} aria-labelledby={`${id}-title`} onCancel={onClose} onClose={onClose}
    className="stock-wheel-dialog p-0 backdrop:bg-black/50">
    <div className="stock-wheel-toolbar flex h-14 items-center justify-between px-3">
      <button type="button" aria-label={language === 'zh' ? '關閉' : 'Close'} title={language === 'zh' ? '關閉' : 'Close'} onClick={onClose} className="grid size-11 place-items-center rounded hover:bg-slate-100"><X size={18} /></button>
      <h2 id={`${id}-title`} className="text-sm font-bold">{t('selectStock')}</h2>
      <button type="button" aria-label={language === 'zh' ? '確認股票' : 'Confirm stock'} title={language === 'zh' ? '確認股票' : 'Confirm stock'} disabled={!stocks.length} onClick={() => onSelect(stocks[index].id)} className="grid size-11 place-items-center rounded hover:bg-slate-100 disabled:opacity-30"><Check size={20} /></button>
    </div>
    <div className="stock-wheel-frame">
      <div className="stock-wheel-selection" aria-hidden="true" />
      <div ref={wheel} role="listbox" aria-label={t('selectStock')} aria-activedescendant={stocks[index] ? `${id}-${stocks[index].id}` : undefined}
        tabIndex={0} className="stock-wheel" onScroll={event => setIndex(clamp(Math.round(event.currentTarget.scrollTop / ROW_HEIGHT)))}
        onKeyDown={event => {
          if (['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(event.key)) event.preventDefault();
          if (event.key === 'ArrowUp') move(index - 1);
          if (event.key === 'ArrowDown') move(index + 1);
          if (event.key === 'Home') move(0);
          if (event.key === 'End') move(stocks.length - 1);
          if (event.key === 'Enter' && stocks[index]) onSelect(stocks[index].id);
        }}>
        {stocks.map((stock, position) => <div key={stock.id} id={`${id}-${stock.id}`} role="option" aria-selected={index === position}
          onClick={() => move(position)} className="stock-wheel-option">
          <span className="stock-wheel-symbol">{stock.symbol}</span><span className="stock-wheel-separator" aria-hidden="true" /><span className="stock-wheel-name" title={stock.name}>{stock.name}</span>
        </div>)}
      </div>
    </div>
  </dialog>;
}
