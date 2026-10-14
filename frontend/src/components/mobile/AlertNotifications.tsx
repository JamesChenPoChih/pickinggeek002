import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { alertRequest } from '../../api';
import { useLanguage } from '../../i18n';
import { ruleName } from './AlertDialog';

interface Notice { id: number; title: string; body: string; created_at: string; read_at: string | null; payload: { symbol?: string; market_date?: string; price?: number; rules?: { kind: string }[] } }
interface Notices { unread: number; items: Notice[] }
export default function AlertNotifications() {
  const { language, t } = useLanguage(); const zh = language === 'zh';
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false);
  const [data, setData] = useState<Notices>({ unread: 0, items: [] }), [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController(); let inFlight = false;
    const refresh = async () => {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true; if (open) setLoading(true);
      try { const value = await alertRequest<Notices>('notifications/', { signal: controller.signal }); if (!controller.signal.aborted) { setData({ unread: value.unread ?? 0, items: value.items ?? [] }); setError(''); } }
      catch { if (!controller.signal.aborted && open) setError(zh ? '通知暫時無法載入' : 'Notifications unavailable'); }
      finally { inFlight = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [open, zh]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus(); return () => previous?.focus();
  }, [open]);
  return <>
    <button type="button" onClick={() => setOpen(true)} title={t('notification')} aria-label={t('notification')} className="relative grid size-9 place-items-center rounded-full text-slate-600 hover:bg-slate-100"><Bell size={19} />{data.unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1 text-[8px] text-white">{data.unread > 99 ? '99+' : data.unread}</span>}</button>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="notifications-title" className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-slate-200 bg-white text-slate-900 outline-none" onKeyDown={event => {
        if (event.key === 'Escape') setOpen(false);
        if (event.key === 'Tab') {
          const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
          if (event.shiftKey && (document.activeElement === buttons[0] || document.activeElement === panel.current)) { event.preventDefault(); buttons.at(-1)?.focus(); }
          else if (!event.shiftKey && (document.activeElement === buttons.at(-1) || document.activeElement === panel.current)) { event.preventDefault(); buttons[0]?.focus(); }
        }
      }}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3"><Bell size={17} /><h2 id="notifications-title" className="flex-1 text-sm font-bold">{zh ? '警示通知' : 'Alert notifications'}</h2><button type="button" onClick={() => setOpen(false)} aria-label={zh ? '關閉通知' : 'Close notifications'} className="grid size-10 place-items-center"><X size={18} /></button></div>
        <div className="min-h-0 overflow-y-auto px-4"><ul className="divide-y divide-slate-200">{data.items.map(item => <li key={item.id} className="py-4"><p className="text-xs font-bold">{item.payload?.symbol ? `${item.payload.symbol} · ${zh ? '技術警示' : 'Technical alert'}` : item.title}{!item.read_at && <span className="ml-2 text-[10px] text-emerald-600">{zh ? '未讀' : 'Unread'}</span>}</p><p className="mt-1 text-xs leading-6 text-slate-600">{item.payload?.rules?.length ? item.payload.rules.map(rule => ruleName(rule.kind, zh)).join(' · ') : item.body}</p><p className="mt-1 text-[10px] text-slate-400">{item.payload?.market_date ?? new Date(item.created_at).toLocaleString()} {item.payload?.price != null ? `· ${item.payload.price}` : ''}</p></li>)}</ul>{!data.items.length && <p role="status" className="py-10 text-center text-xs text-slate-400">{loading ? (zh ? '載入中…' : 'Loading…') : (zh ? '尚無警示通知' : 'No alerts yet')}</p>}{error && <p role="alert" className="pb-4 text-xs text-rose-600">{error}</p>}</div>
        <button type="button" disabled={!data.unread || loading} onClick={async () => {
          setLoading(true);
          try { setData(await alertRequest<Notices>('notifications/', { method: 'POST' })); setError(''); }
          catch { setError(zh ? '無法更新已讀狀態' : 'Unable to mark read'); } finally { setLoading(false); }
        }} className="flex min-h-12 shrink-0 items-center justify-center gap-2 border-t border-slate-200 disabled:opacity-40"><CheckCheck size={17} /><span className="text-xs font-semibold">{zh ? '全部標為已讀' : 'Mark all read'}</span></button>
      </div>
    </div>}
  </>;
}
