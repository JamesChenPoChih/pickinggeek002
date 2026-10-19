import { useEffect, useRef, useState } from 'react';
import { Bell, Save, X } from 'lucide-react';
import { alertRequest } from '../../api';
import { useLanguage } from '../../i18n';
import type { StockPosition } from '../../types/stock';

type Rule = { kind: string; [key: string]: string | number };
export interface AlertSettings { id: number | null; enabled: boolean; frequency: 'ONCE' | 'DAILY'; rules: Rule[]; active_count: number; limit: number }
type Group = 'MA' | 'MACD' | 'BB' | 'SQUEEZE';
interface Parameter { key: string; zh: string; en: string; options?: { value: string | number; zh: string; en: string }[]; min?: number; max?: number; step?: number }
interface Definition { kind: string; group: Group; zh: string; en: string; defaults: Rule; parameters: Parameter[] }
const periods = [5, 10, 20, 60, 100, 200, 250].map(value => ({ value, zh: `${value} 日`, en: `${value} days` }));
const direction: Parameter = { key: 'direction', zh: '方向', en: 'Direction', options: [{ value: 'UP', zh: '向上／多頭', en: 'Up / bullish' }, { value: 'DOWN', zh: '向下／空頭', en: 'Down / bearish' }] };
const period = (key: string, zh: string, en: string): Parameter => ({ key, zh, en, options: periods });
const definitions: Definition[] = [
  { kind: 'ma_price_cross', group: 'MA', zh: '股價突破／跌破均線', en: 'Price crosses MA', defaults: { kind: 'ma_price_cross', period: 200, direction: 'UP' }, parameters: [direction, period('period', '均線', 'MA')] },
  { kind: 'ma_cross', group: 'MA', zh: '均線黃金／死亡交叉', en: 'MA golden / death cross', defaults: { kind: 'ma_cross', short: 20, long: 60, direction: 'UP' }, parameters: [direction, period('short', '短均線', 'Short MA'), period('long', '長均線', 'Long MA')] },
  { kind: 'ma_alignment', group: 'MA', zh: '多頭／空頭排列：5、20、60、200 MA', en: 'MA alignment: 5, 20, 60, 200', defaults: { kind: 'ma_alignment', direction: 'UP' }, parameters: [direction] },
  { kind: 'ma_bias', group: 'MA', zh: '乖離率超過門檻', en: 'Bias crosses threshold', defaults: { kind: 'ma_bias', period: 20, threshold: 15 }, parameters: [{ ...period('period', '均線', 'MA'), options: periods.filter(option => [20, 60].includes(option.value)) }, { key: 'threshold', zh: '乖離率 %（正／負）', en: 'Bias % (+ / -)', min: -99, max: 100, step: 0.5 }] },
  { kind: 'macd_cross', group: 'MACD', zh: 'MACD 黃金／死亡交叉', en: 'MACD golden / death cross', defaults: { kind: 'macd_cross', direction: 'UP' }, parameters: [direction] },
  { kind: 'macd_zero', group: 'MACD', zh: 'DIF 突破／跌破零軸', en: 'DIF crosses zero', defaults: { kind: 'macd_zero', direction: 'UP' }, parameters: [direction] },
  { kind: 'macd_trend', group: 'MACD', zh: '柱狀體連續遞增／遞減', en: 'Consecutive histogram changes', defaults: { kind: 'macd_trend', direction: 'UP', days: 3 }, parameters: [direction, { key: 'days', zh: '連續天數', en: 'Days', min: 2, max: 10, step: 1 }] },
  { kind: 'bb_boundary', group: 'BB', zh: '股價突破上軌／跌破下軌', en: 'Price crosses outer band', defaults: { kind: 'bb_boundary', direction: 'UP' }, parameters: [direction] },
  { kind: 'bb_middle', group: 'BB', zh: '回測中軌並收回中軌以上', en: 'Retest and hold middle band', defaults: { kind: 'bb_middle' }, parameters: [] },
  { kind: 'bb_width', group: 'BB', zh: '通道頻寬跌破門檻', en: 'Bandwidth falls below threshold', defaults: { kind: 'bb_width', threshold: 5 }, parameters: [{ key: 'threshold', zh: '頻寬 %', en: 'Bandwidth %', min: 0.1, max: 100, step: 0.1 }] },
  { kind: 'bb_expansion', group: 'BB', zh: '帶量突破與開口放大', en: 'Volume breakout and expansion', defaults: { kind: 'bb_expansion', growth: 20, volume_ratio: 1.5 }, parameters: [{ key: 'growth', zh: '頻寬增幅 %', en: 'Bandwidth growth %', min: 1, max: 100, step: 1 }, { key: 'volume_ratio', zh: '成交量／前 20 日平均', en: 'Volume / prior 20-day average', min: 1, max: 10, step: 0.1 }] },
  { kind: 'squeeze_on', group: 'SQUEEZE', zh: 'Squeeze 開啟（進入壓縮）', en: 'Squeeze enters compression', defaults: { kind: 'squeeze_on' }, parameters: [] },
  { kind: 'squeeze_release', group: 'SQUEEZE', zh: 'Squeeze 解除（釋放）', en: 'Squeeze releases', defaults: { kind: 'squeeze_release' }, parameters: [] },
  { kind: 'squeeze_momentum', group: 'SQUEEZE', zh: '多頭／空頭動能轉強', en: 'Momentum strengthens', defaults: { kind: 'squeeze_momentum', direction: 'UP' }, parameters: [direction] },
];
export const ruleName = (kind: string, zh: boolean) => {
  const definition = definitions.find(item => item.kind === kind);
  return definition ? (zh ? definition.zh : definition.en) : kind;
};

export default function AlertDialog({ stock, onClose, onSaved }: { stock: StockPosition; onClose: () => void; onSaved: () => void }) {
  const { language } = useLanguage(); const zh = language === 'zh';
  const [group, setGroup] = useState<Group>('MA');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rules, setRules] = useState<Record<string, Rule>>(Object.fromEntries(definitions.map(item => [item.kind, { ...item.defaults }])));
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<'ONCE' | 'DAILY'>('ONCE');
  const [activeCount, setActiveCount] = useState(0), [alertLimit, setAlertLimit] = useState(3);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setReady(false); setError('');
    alertRequest<AlertSettings>(`stocks/${stock.id}/alert/`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setEnabled(value.enabled); setFrequency(value.frequency);
      setActiveCount(value.active_count); setAlertLimit(value.limit);
      setSelected(new Set(value.rules.map(rule => rule.kind)));
      setRules(current => ({ ...current, ...Object.fromEntries(value.rules.map(rule => [rule.kind, rule])) }));
      setReady(true);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Error'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [stock.id, retry]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
      if (event.key === 'Tab') {
        const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? []);
        const first = items[0], last = items.at(-1);
        const outside = !dialog.current?.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current || outside)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current || outside)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [saving, onClose]);
  function change(kind: string, key: string, value: string | number) {
    setRules(current => ({ ...current, [kind]: { ...current[kind], [key]: value } }));
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="alert-title" className="stock-alert-dialog flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-slate-200 bg-white text-slate-900 shadow-xl outline-none">
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3"><Bell size={18} /><div className="min-w-0 flex-1"><h2 id="alert-title" className="text-sm font-bold">{zh ? '設定個股警示' : 'Set Alert'}: {stock.symbol}</h2><p className="break-words text-xs text-slate-400">{stock.name} · {zh ? '日 K／完成交易日' : 'Daily / completed sessions'}</p></div><button type="button" disabled={saving} onClick={onClose} aria-label={zh ? '關閉警示設定' : 'Close alert settings'} title={zh ? '關閉' : 'Close'} className="grid size-10 shrink-0 place-items-center"><X size={19} /></button></header>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={async event => {
        event.preventDefault();
        if (enabled && !selected.size) { setError(zh ? '請至少選擇一個警示條件' : 'Select at least one condition'); return; }
        setSaving(true); setError('');
        try { await alertRequest(`stocks/${stock.id}/alert/`, { method: 'PUT', body: JSON.stringify({ enabled, frequency, rules: Array.from(selected).map(kind => rules[kind]) }) }); window.dispatchEvent(new CustomEvent('pickinggeek:alerts-updated', { detail: { stockId: stock.id, enabled } })); onSaved(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Error'); }
        finally { setSaving(false); }
      }}>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? <p role="status" className="py-8 text-center text-xs">{zh ? '載入中…' : 'Loading…'}</p> : <>
            <button type="button" role="switch" aria-label={zh ? '啟用個股警示' : 'Enable stock alerts'} aria-checked={enabled} disabled={saving || (!enabled && activeCount >= alertLimit)} onClick={() => { setEnabled(value => !value); setError(''); }} className="mb-1 flex min-h-11 w-full items-center justify-between gap-3 text-left disabled:opacity-50"><span className="text-xs font-semibold">{zh ? '啟用個股警示' : 'Enable stock alerts'}</span><span aria-hidden="true" data-checked={enabled} className="app-switch-track relative h-6 w-11 shrink-0 rounded-full transition-colors"><span className={`app-switch-thumb absolute left-0.5 top-0.5 size-5 rounded-full shadow-sm transition-transform motion-reduce:transition-none ${enabled ? 'translate-x-5' : 'translate-x-0'}`} /></span></button>
            <p className="mb-4 text-[10px] text-slate-400">{zh ? `啟用中的警示 ${activeCount}/${alertLimit}` : `Active alerts ${activeCount}/${alertLimit}`}</p>
            <div role="tablist" aria-label={zh ? '指標類型' : 'Indicator type'} className="mb-3 grid grid-cols-4 border-b border-slate-200">{(['MA', 'MACD', 'BB', 'SQUEEZE'] as const).map(item => <button type="button" role="tab" id={`alert-tab-${item}`} aria-controls="alert-rule-panel" tabIndex={group === item ? 0 : -1} aria-selected={group === item} key={item} onClick={() => setGroup(item)} onKeyDown={event => {
              const groups: Group[] = ['MA', 'MACD', 'BB', 'SQUEEZE'];
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault(); const next = groups[(groups.indexOf(item) + (event.key === 'ArrowRight' ? 1 : 3)) % 4];
                setGroup(next); document.getElementById(`alert-tab-${next}`)?.focus();
              }
            }} className={`min-h-11 border-b-2 ${group === item ? 'border-emerald-500 text-slate-900' : 'border-transparent text-slate-400'}`}><span className="text-xs font-semibold">{item === 'MA' ? (zh ? '均線 MA' : 'MA') : item === 'BB' ? (zh ? '布林通道' : 'Bollinger') : item === 'SQUEEZE' ? 'Squeeze' : item}</span></button>)}</div>
            <div role="tabpanel" id="alert-rule-panel" aria-labelledby={`alert-tab-${group}`} className="divide-y divide-slate-200">{definitions.filter(item => item.group === group).map(item => <fieldset key={item.kind} disabled={saving || !enabled} className="py-3 disabled:opacity-50">
              <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={selected.has(item.kind)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(item.kind); else next.delete(item.kind); return next; })} />{zh ? item.zh : item.en}</label>
              <div className="grid grid-cols-2 gap-2 pl-6">{item.parameters.map(parameter => <label key={parameter.key} className="min-w-0 text-xs text-slate-500">{zh ? parameter.zh : parameter.en}
                {parameter.options ? <select aria-label={`${zh ? item.zh : item.en} ${zh ? parameter.zh : parameter.en}`} disabled={!selected.has(item.kind)} value={rules[item.kind][parameter.key]} onChange={event => change(item.kind, parameter.key, typeof item.defaults[parameter.key] === 'number' ? Number(event.target.value) : event.target.value)} className="mt-1 h-9 w-full min-w-0 rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 disabled:opacity-40">{parameter.options.map(option => <option key={option.value} value={option.value}>{zh ? option.zh : option.en}</option>)}</select>
                  : <input aria-label={`${zh ? item.zh : item.en} ${zh ? parameter.zh : parameter.en}`} type="number" required disabled={!selected.has(item.kind)} min={parameter.min} max={parameter.max} step={parameter.step} value={rules[item.kind][parameter.key]} onChange={event => change(item.kind, parameter.key, event.target.value === '' ? '' : Number(event.target.value))} className="mt-1 h-9 w-full min-w-0 rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 disabled:opacity-40" />}
              </label>)}</div>
            </fieldset>)}</div>
            <fieldset className="mt-3 border-t border-slate-200 pt-4"><legend className="text-xs font-bold">{zh ? '通知頻率' : 'Notification frequency'}</legend>{(['ONCE', 'DAILY'] as const).map(value => <label key={value} className="flex min-h-10 items-center gap-2 text-xs"><input type="radio" name="frequency" value={value} checked={frequency === value} onChange={() => setFrequency(value)} />{value === 'ONCE' ? (zh ? '僅觸發一次即關閉' : 'Once, then disable') : (zh ? '每天最多通知一次' : 'At most once per market day')}</label>)}</fieldset>
          </>}
          {error && <div role="alert" className="mt-3 text-xs text-rose-600">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-2 underline">{zh ? '重新載入' : 'Reload'}</button></div>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-4 py-3"><button type="button" disabled={saving} onClick={onClose} className="min-h-10 rounded border border-slate-300 px-4"><span className="text-xs">{zh ? '取消' : 'Cancel'}</span></button><button type="submit" disabled={!ready || loading || saving} className="flex min-h-10 items-center gap-2 rounded bg-emerald-600 px-4 text-white disabled:opacity-50"><Save size={15} /><span className="text-xs font-semibold">{saving ? (zh ? '儲存中…' : 'Saving…') : (zh ? '儲存設定' : 'Save settings')}</span></button></footer>
      </form>
    </div>
  </div>;
}
