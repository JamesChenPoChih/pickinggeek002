import { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, CheckCheck, X } from 'lucide-react';
import { alertRequest } from '../../api';
import { useLanguage } from '../../i18n';
import { alertSummary, type AlertPayload } from './alertSummary';

interface Notice { id: number; title: string; body: string; created_at: string; read_at: string | null; payload: AlertPayload }
interface Notices { unread: number; today_unread?: number; active_alert_stock_ids?: number[]; items: Notice[] }
export default function AlertNotifications() {
  const { language, t } = useLanguage(); const zh = language === 'zh';
  const notificationsPath = `notifications/?timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false);
  const [data, setData] = useState<Notices>({ unread: 0, items: [] }), [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const latestId = useRef<number | null>(null);
  const [toast, setToast] = useState<Notice | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const isStockAlert = (notice: Notice) => notice.payload?.type === 'stock_alert' || !!notice.payload?.rules?.length;
  const todayUnread = data.today_unread ?? data.items.filter(item => !item.read_at && isStockAlert(item) && new Date(item.created_at).toDateString() === new Date().toDateString()).length;
  useEffect(() => {
    const controller = new AbortController(); let inFlight = false;
    const load = async () => {
      const value = await alertRequest<Notices>(notificationsPath, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (Array.isArray(value.active_alert_stock_ids)) window.dispatchEvent(new CustomEvent('pickinggeek:alert-status', { detail: value.active_alert_stock_ids }));
      const items = value.items ?? [];
      const fresh = items.filter(item => !item.read_at && isStockAlert(item) && item.id > (latestId.current ?? Infinity))
        .sort((a, b) => b.id - a.id)[0];
      latestId.current = Math.max(latestId.current ?? 0, ...items.map(item => item.id));
      if (fresh && !open) setToast(fresh);
      setData({ unread: value.unread ?? 0, today_unread: value.today_unread, items }); setError('');
    };
    const refresh = async () => {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true; if (open) setLoading(true);
      try {
        await load();
        try {
          const result = await alertRequest<{ created: number; failed: number; cached?: boolean }>('alerts/check/', { method: 'POST', signal: controller.signal });
          if (!controller.signal.aborted && !result.cached) setCheckFailed(result.failed > 0);
          if (result.created > 0) await load();
        } catch { if (!controller.signal.aborted) setCheckFailed(true); }
      }
      catch { if (!controller.signal.aborted && open) setError(zh ? '通知暫時無法載入' : 'Notifications unavailable'); }
      finally { inFlight = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 15000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pickinggeek:alerts-updated', refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('pickinggeek:alerts-updated', refresh); };
  }, [open, zh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 10000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus(); return () => previous?.focus();
  }, [open]);
  return <>
    <button type="button" onClick={() => { setToast(null); setOpen(true); }} title={todayUnread ? (zh ? `今日 ${todayUnread} 則新警示` : `${todayUnread} new alerts today`) : t('notification')} aria-label={t('notification')} data-today-alerts={todayUnread} className={`relative grid size-9 place-items-center rounded-full hover:bg-slate-100 ${todayUnread ? 'text-rose-500' : 'text-slate-600'}`}><Bell size={19} fill={todayUnread ? 'currentColor' : 'none'} fillOpacity={0.2} />{data.unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1 text-[8px] text-white">{data.unread > 99 ? '99+' : data.unread}</span>}</button>
    {toast && !open && <div role="status" aria-live="polite" className="fixed inset-x-4 top-20 z-50 mx-auto flex max-w-md items-start gap-2 rounded-md border border-slate-200 bg-white p-3 text-slate-900 shadow-lg"><BellRing size={18} className="mt-1 shrink-0 text-rose-500" /><button type="button" onClick={() => { setToast(null); setOpen(true); }} className="min-w-0 flex-1 text-left"><strong className="block text-xs">{toast.payload.symbol} · {zh ? '新警示' : 'New alert'}</strong><span className="mt-1 block break-words text-xs leading-5">{alertSummary(toast.payload, zh) || toast.body}</span></button><button type="button" aria-label={zh ? '關閉提示' : 'Dismiss alert'} onClick={() => setToast(null)} className="grid size-8 shrink-0 place-items-center"><X size={16} /></button></div>}
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
        <div className="min-h-0 overflow-y-auto px-4"><ul className="divide-y divide-slate-200">{data.items.map(item => <li key={item.id} className="py-4"><p className="text-xs font-bold">{item.payload?.symbol ? `${item.payload.symbol} · ${zh ? '技術警示' : 'Technical alert'}` : item.title}{!item.read_at && <span className="ml-2 text-[10px] text-emerald-600">{zh ? '未讀' : 'Unread'}</span>}</p><p className="mt-1 text-xs leading-6 text-slate-600">{item.payload?.rules?.length ? alertSummary(item.payload, zh) : item.body}</p><p className="mt-1 text-[10px] text-slate-400">{item.payload?.market_date ?? new Date(item.created_at).toLocaleString()} {item.payload?.price != null ? `· ${item.payload.price}` : ''}</p></li>)}</ul>{!data.items.length && <p role="status" className="py-10 text-center text-xs text-slate-400">{loading ? (zh ? '載入中…' : 'Loading…') : (zh ? '尚無警示通知' : 'No alerts yet')}</p>}{checkFailed && <p className="pb-4 text-xs text-slate-500">{zh ? '部分警示行情暫時無法檢查，稍後會再試' : 'Some alert data is unavailable; checks will resume automatically'}</p>}{error && <p role="alert" className="pb-4 text-xs text-rose-600">{error}</p>}</div>
        <button type="button" disabled={!data.unread || loading} onClick={async () => {
          setLoading(true);
          try { setData(await alertRequest<Notices>(notificationsPath, { method: 'POST' })); setToast(null); setError(''); }
          catch { setError(zh ? '無法更新已讀狀態' : 'Unable to mark read'); } finally { setLoading(false); }
        }} className="flex min-h-12 shrink-0 items-center justify-center gap-2 border-t border-slate-200 disabled:opacity-40"><CheckCheck size={17} /><span className="text-xs font-semibold">{zh ? '全部標為已讀' : 'Mark all read'}</span></button>
      </div>
    </div>}
  </>;
}
