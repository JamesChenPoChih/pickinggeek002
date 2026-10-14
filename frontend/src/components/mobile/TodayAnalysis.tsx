import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../../i18n';
import type { AnalysisRecord } from './AIAnalysisPanel';

export interface HistorySelection { key: string; index: number }
interface Props {
  records: Record<string, AnalysisRecord[]>;
  onSelect: (selection: HistorySelection) => void;
  onClose: () => void;
}

export default function TodayAnalysis({ records, onSelect, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { language, t } = useLanguage();
  const zh = language === 'zh';
  const today = new Date().toDateString();
  const items = Object.entries(records).flatMap(([key, list]) => list.map((record, index) => ({ key, index, record })))
    .filter(item => item.record.createdAt && new Date(item.record.createdAt).toDateString() === today)
    .sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt));
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={onClose} onClose={onClose} aria-labelledby="today-analysis-title" className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-md rounded-md border border-slate-200 bg-white p-0 text-slate-900 backdrop:bg-black/50">
    <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3"><h2 id="today-analysis-title" className="text-base font-bold">{zh ? '今日分析紀錄' : "Today's analyses"}</h2><button type="button" onClick={onClose} aria-label={zh ? '關閉' : 'Close'} className="grid size-10 place-items-center rounded hover:bg-slate-100"><X size={18} /></button></div>
    <div className="stock-search-list px-4">{items.length ? items.map(({ key, index, record }) => <button key={`${key}:${index}`} type="button" onClick={() => onSelect({ key, index })} className="block w-full py-3 text-left hover:bg-slate-50">
      <span className="flex items-center justify-between gap-2 text-xs"><strong>{record.symbol}</strong><span className="text-slate-400">{new Date(record.createdAt).toLocaleTimeString(language === 'zh' ? 'zh-TW' : 'en-US', { hour: '2-digit', minute: '2-digit' })} · {record.mode === 'deep' ? t('deepReport') : t('quickAnswer')}</span></span>
      <span className="mt-1 block break-words text-xs text-slate-500">{record.question}</span>
    </button>) : <p className="py-6 text-center text-sm text-slate-500">{zh ? '今天尚無已完成的分析' : 'No completed analyses today'}</p>}</div>
  </dialog>;
}
