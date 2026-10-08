import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import type { StockPosition } from "../../types/stock";
import { useLanguage } from "../../i18n";

interface StockCardProps {
  title: string;
  stock: StockPosition;
  stocks: StockPosition[];
  onSelect: (stock: StockPosition) => void;
  onRemove: (stock: StockPosition) => void;
  removing: boolean;
  removeError: string;
}

function formatPrice(stock: StockPosition): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: stock.market === "TW" ? 0 : 2,
    maximumFractionDigits: stock.market === "TW" ? 0 : 2,
  }).format(stock.currentPrice);
}

export default function StockCard({ title, stock, stocks, onSelect, onRemove, removing, removeError }: StockCardProps) {
  const { t } = useLanguage();
  const positive = stock.changePercent >= 0;
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const groups = [
    { market: 'US', title: 'US Stock' },
    { market: 'TW', title: 'Taiwan Stock' },
  ].map(group => ({ ...group, items: stocks.filter(item => item.market === group.market) }));
  const focusOption = (last = false) => {
    const options = picker.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const selected = picker.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    (last ? options?.[options.length - 1] : selected ?? options?.[0])?.focus();
  };
  useEffect(() => {
    if (!open) return;
    focusOption();
    const outside = (event: PointerEvent) => {
      if (!picker.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-400">{title}</p><h1 className="mt-1 break-words text-lg font-bold text-slate-900">{stock.name}</h1><p className="text-[11px] text-slate-400">{stock.symbol} · {stock.market}</p></div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div ref={picker} className="relative" onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
          }}>
            <button ref={trigger} type="button" aria-label={t('selectStock')} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
              onClick={() => setOpen(value => !value)} onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
              }} className="flex h-9 w-24 items-center justify-end gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 text-[10px] font-semibold text-slate-700 hover:border-slate-300 focus-visible:outline-2 focus-visible:outline-sky-500">
              <span className="min-w-0 truncate font-mono tabular-nums">{stock.symbol}</span>
              <ChevronDown size={12} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && <div id={listId} role="listbox" aria-label={t('selectStock')} className="absolute right-0 top-full z-50 mt-1.5 max-h-72 w-40 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg" onKeyDown={(event) => {
              const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
              const index = options.indexOf(document.activeElement as HTMLButtonElement);
              if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                options[next]?.focus();
              }
            }}>
              {groups.filter(group => group.items.length).map(group => <div key={group.market} role="group" aria-label={group.title} className="border-t border-slate-100 first:border-t-0">
                <div className="px-3 pb-1 pt-2 text-[13.5px] font-bold text-slate-500">{group.title}</div>
                {group.items.map(item => <button key={item.id} type="button" role="option" aria-selected={item.id === stock.id} tabIndex={-1}
                  onClick={() => { onSelect(item); setOpen(false); trigger.current?.focus(); }}
                  className={`flex h-9 w-full items-center justify-between gap-2 px-3 text-[10px] hover:bg-slate-50 focus:bg-sky-50 focus:outline-none ${item.id === stock.id ? 'bg-sky-50 text-sky-700' : 'text-slate-600'}`}>
                  <span className="w-3 shrink-0">{item.id === stock.id && <Check size={12} />}</span>
                  <span className="min-w-0 flex-1 truncate text-right font-mono tabular-nums">{item.symbol}</span>
                </button>)}
              </div>)}
            </div>}
          </div>
          <button
            type="button"
            onClick={() => onRemove(stock)}
            disabled={removing || stocks.length <= 1}
            title={stocks.length <= 1 ? t("keepOneStock") : `${t("removeStock")} ${stock.symbol}`}
            className="flex h-7 items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 text-[10px] font-semibold text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {removing ? <LoaderCircle size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {removing ? t("removingStock") : t("removeStock")}
          </button>
          {removeError && <span className="max-w-32 text-right text-[9px] leading-tight text-rose-600">{removeError}</span>}
        </div>
      </div>
      <div className="mt-6 flex items-end justify-between">
        <div><span data-testid="stock-card-price" className="text-4xl font-semibold leading-none tracking-normal text-slate-950">{formatPrice(stock)}</span><span className="ml-1 text-xs text-slate-400">{stock.currency}</span></div>
        <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${positive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
          {positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{positive ? "+" : ""}{stock.changePercent.toFixed(2)}%
        </span>
      </div>
    </section>
  );
}
