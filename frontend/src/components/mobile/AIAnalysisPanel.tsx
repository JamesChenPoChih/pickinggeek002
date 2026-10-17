import { useEffect, useRef, useState } from "react";
import { Bot, ChevronLeft, ChevronRight, History, Languages, LoaderCircle, RotateCcw, Send, Sparkles } from "lucide-react";

import { streamAnalysis, translateAnalysis, type AnalysisMode, type AnalysisContext, type AnalysisPeer, type QuickReport, type DetailedReport } from "../../api";
import type { StockPosition } from "../../types/stock";
import { useLanguage } from "../../i18n";
import AIAnswer from './AIAnswer';
import TodayAnalysis, { type HistorySelection } from './TodayAnalysis';

interface AIAnalysisPanelProps {
  stock: StockPosition;
  token: string;
  historyStore: React.MutableRefObject<Record<string, AnalysisRecord[]>>;
  selection: HistorySelection | null;
  onSelectHistory: (selection: HistorySelection) => void;
}

export interface AnalysisRecord {
  createdAt: string; symbol: string;
  answer: string; model: string; context: AnalysisContext | null;
  question: string; mode: AnalysisMode; peers: AnalysisPeer[];
  report?: QuickReport | DetailedReport;
  language?: 'zh' | 'en';
  translations?: Partial<Record<'zh' | 'en', QuickReport | DetailedReport>>;
  translationVersion?: number;
}

export function AIAnalysisPanel({ stock, token, historyStore, selection, onSelectHistory }: AIAnalysisPanelProps) {
  const { language, t } = useLanguage();
  const [mode, setMode] = useState<AnalysisMode>("quick");
  const [question, setQuestion] = useState(t("defaultQuestion"));
  const [answer, setAnswer] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [context, setContext] = useState<AnalysisContext | null>(null);
  const [report, setReport] = useState<QuickReport | DetailedReport | undefined>();
  const [answerLanguage, setAnswerLanguage] = useState(language);
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const translationRequest = useRef<AbortController | null>(null);
  const [peers, setPeers] = useState<AnalysisPeer[]>([]);
  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [todayOpen, setTodayOpen] = useState(false);
  const request = useRef<AbortController | null>(null);
  const zh = language === 'zh';
  const historyKey = `${stock.id}:${language}`;
  function localizedQuestion(value: string) {
    return ['請幫我做AI分析', 'Please provide an AI analysis', '目前技術面適合分批布局嗎？',
      'Do the current technical signals support gradual buying?'].includes(value) ? t('defaultQuestion') : value;
  }

  useEffect(() => {
    request.current?.abort();
    translationRequest.current?.abort();
    setTranslating(false); setTranslationError(''); setAnswerLanguage(language);
    setLoading(false); setAnswer(''); setModel(''); setContext(null); setReport(undefined);
    setAnalysisError('');
    const selectedKey = selection?.key.startsWith(`${stock.id}:`) ? selection.key : historyKey;
    const saved = historyStore.current[selectedKey] ?? [];
    const index = selectedKey === selection?.key ? Math.min(selection.index, saved.length - 1) : saved.length - 1;
    const latest = saved[index];
    setHistory(saved); setHistoryIndex(index);
    if (latest) {
      setAnswer(latest.answer); setModel(latest.model); setContext(latest.context);
      setReport(latest.report);
      setAnswerLanguage(latest.language ?? (selectedKey.endsWith(':en') ? 'en' : 'zh'));
      setQuestion(localizedQuestion(latest.question)); setMode(latest.mode); setPeers(latest.peers);
    } else {
    setQuestion(t('defaultQuestion'));
    setPeers(stock.symbol === 'NBIS' ? [
      { symbol: 'NVDA', market: 'US', role: 'industry' }, { symbol: 'CRWV', market: 'US', role: 'peer' },
    ] : [{ symbol: '', market: stock.market as 'US' | 'TW', role: 'industry' }, { symbol: '', market: stock.market as 'US' | 'TW', role: 'peer' }]);
    }
    return () => { request.current?.abort(); translationRequest.current?.abort(); };
  }, [stock.id, stock.symbol, stock.market, language, historyKey, historyStore, t, selection]);

  function showHistory(index: number) {
    if (loading || translating || index < 0 || index >= history.length) return;
    const record = history[index];
    setAnalysisError('');
    setAnswer(record.answer); setModel(record.model); setContext(record.context);
    setReport(record.report);
    setAnswerLanguage(record.language ?? (selection?.key.endsWith(':en') ? 'en' : language));
    setTranslationError('');
    setQuestion(localizedQuestion(record.question)); setMode(record.mode); setPeers(record.peers);
    setHistoryIndex(index);
    onSelectHistory({ key: selection?.key.startsWith(`${stock.id}:`) ? selection.key : historyKey, index });
  }

  async function submitAnalysis() {
    if (!question.trim() || loading || translating) return;
    const controller = new AbortController();
    request.current = controller;

    setLoading(true);
    setAnalysisError('');
    setTranslationError(''); setAnswerLanguage(language);
    setAnswer("");
    setModel("");
    setContext(null);
    setReport(undefined);
    setHistoryIndex(history.length);
    const record: AnalysisRecord = { language, createdAt: '', symbol: stock.symbol, answer: '', model: '', context: null, question: question.trim(), mode, peers: peers.map(peer => ({ ...peer })) };
    let completed = false;

    try {
      await streamAnalysis({
        token,
        stockId: stock.id,
        question: question.trim(),
        mode,
        comparisons: mode === 'deep' ? peers.filter(peer => peer.symbol.trim()).map(peer => ({ ...peer, symbol: peer.symbol.trim() })) : [], language, signal: controller.signal,
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          if (event.type === 'context') { record.context = event.data; setContext(event.data); }
          if (event.type === 'report') { record.report = event.sections; setReport(event.sections); }
          if (event.type === "meta") { record.model = event.model ?? ''; setModel(record.model); }
          if (event.type === "token") { record.answer += event.content; setAnswer(record.answer); }
          if (event.type === 'done') completed = true;
          if (event.type === "error") throw new Error(event.message ?? t("aiUnavailable"));
        },
      });
      if (!controller.signal.aborted && (!completed || !record.answer)) throw new Error(t('aiUnavailable'));
      if (!controller.signal.aborted && completed && record.answer) {
        record.createdAt = new Date().toISOString();
        const records = [...(historyStore.current[historyKey] ?? []), record];
        historyStore.current[historyKey] = records;
        setHistory(records);
        setHistoryIndex(records.length - 1);
        onSelectHistory({ key: historyKey, index: records.length - 1 });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setAnswer(''); setReport(undefined);
      setAnalysisError(error instanceof Error ? error.message : t("aiUnavailable"));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function translateCurrent() {
    if (!report || loading || translating) return;
    const target = answerLanguage === 'zh' ? 'en' : 'zh';
    const record = history[historyIndex];
    const originalLanguage = record?.language ?? (selection?.key.endsWith(':en') ? 'en' : language);
    const cached = target === originalLanguage ? record?.report : (record?.translationVersion === 3 ? record.translations?.[target] : undefined);
    setTranslationError('');
    if (cached) { setReport(cached); setAnswerLanguage(target); return; }
    const controller = new AbortController();
    translationRequest.current = controller;
    setTranslating(true);
    try {
      const result = await translateAnalysis(token, record?.report ?? report, target, controller.signal);
      if (controller.signal.aborted) return;
      if (record) {
        if (record.translationVersion !== 3) record.translations = {};
        record.translationVersion = 3;
        record.translations ??= {}; record.translations[target] = result;
      }
      setReport(result); setAnswerLanguage(target);
    } catch (error) {
      if (!controller.signal.aborted) setTranslationError(error instanceof Error ? error.message : (zh ? '翻譯失敗，原文已保留' : 'Translation failed; original preserved'));
    } finally { if (!controller.signal.aborted) setTranslating(false); }
  }

  const evidence = context && <div className="mb-3 space-y-2 text-xs text-slate-500">
        {[context.target, ...context.comparisons].some(asset => asset.news) && <h4 className="ai-report-divider border-t pt-3 text-xs font-bold text-slate-900">{zh ? '新聞來源' : 'News sources'}</h4>}
        {[context.target, ...context.comparisons].map(asset => <div key={`${asset.market}:${asset.symbol}`}>
        <p className="font-semibold text-slate-900">{asset.symbol} · {asset.status === 'available' ? `${asset.as_of} · ${asset.close?.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${asset.currency}` : (zh ? '行情無法取得' : 'Market data unavailable')}</p>
        {!!asset.missing?.length && <p>{zh ? '部分指標資料不足' : 'Some indicators have insufficient data'}</p>}
        {asset.news && <><p>{zh ? '新聞標題' : 'News headlines'} · {asset.news.window_days}{zh ? ' 天' : ' days'}{asset.news.status === 'unavailable' ? (zh ? ' · 來源暫時無法取得' : ' · Source unavailable') : asset.news.status === 'empty' ? (zh ? ' · 無符合資料' : ' · No matching news') : ''}</p>{asset.news.items.map(item => <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer" className="mt-1 block break-words text-sky-600 underline">{item.title}<span className="block text-[10px] text-slate-400">{item.publisher} · {item.published_at.slice(0, 10)}</span></a>)}</>}
      </div>)}</div>;

  return (
    <section className="border-t border-slate-200 px-5 py-5" aria-labelledby="ai-analysis-title">
      {todayOpen && <TodayAnalysis records={historyStore.current} onClose={() => setTodayOpen(false)} onSelect={item => { setTodayOpen(false); onSelectHistory(item); }} />}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-full bg-slate-950 text-white">
            <Bot size={18} aria-hidden="true" />
          </span>
          <div>
            <h2 id="ai-analysis-title" className="text-sm font-bold text-slate-950">{t("aiAnalysis")}</h2>
            <p className="text-xs text-slate-500">{stock.symbol} {t("technicalCopilot")}</p>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-[28px_28px_28px_20px] items-center gap-1">
          <button type="button" disabled={loading || translating} onClick={() => setTodayOpen(true)} aria-label={zh ? '今日分析紀錄' : "Today's analyses"} title={zh ? '今日分析紀錄' : "Today's analyses"} className="grid h-11 w-7 place-items-center rounded text-slate-900 hover:bg-slate-100 disabled:opacity-30"><History size={18} /></button>
          <button type="button" disabled={loading || translating || historyIndex <= 0} onClick={() => showHistory(historyIndex - 1)} aria-label={zh ? '上一則分析' : 'Previous analysis'} title={zh ? '上一則分析' : 'Previous analysis'} className="grid h-11 w-7 place-items-center rounded text-slate-900 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={18} /></button>
          <button type="button" disabled={loading || translating || historyIndex < 0 || historyIndex >= history.length - 1} onClick={() => showHistory(historyIndex + 1)} aria-label={zh ? '下一則分析' : 'Next analysis'} title={zh ? '下一則分析' : 'Next analysis'} className="grid h-11 w-7 place-items-center rounded text-slate-900 hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={18} /></button>
          <Sparkles size={18} className="text-emerald-500" aria-hidden="true" />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 rounded-md bg-slate-100 p-1" aria-label={t("analysisMode")}>
        <button
          type="button"
          disabled={loading || translating}
          aria-pressed={mode === 'quick'}
          onClick={() => setMode("quick")}
          className={`rounded px-3 py-2 text-xs font-semibold transition ${mode === "quick" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
        >
          {t("quickAnswer")}
        </button>
        <button
          type="button"
          disabled={loading || translating}
          aria-pressed={mode === 'deep'}
          onClick={() => setMode("deep")}
          className={`rounded px-3 py-2 text-xs font-semibold transition ${mode === "deep" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}
        >
          {t('deepReport')}
        </button>
      </div>

      <div className="mb-4 flex items-end gap-2">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={2}
          className="min-h-12 flex-1 resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900"
          placeholder={t("askStock")}
          aria-label={t("aiAnalysis")}
        />
        <button
          type="button"
          onClick={submitAnalysis}
          disabled={loading || translating || !question.trim()}
          className="grid size-12 shrink-0 place-items-center rounded-md bg-slate-950 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          aria-label={t("sendAnalysis")}
          title={t("sendAnalysis")}
        >
          <Send size={18} aria-hidden="true" />
        </button>
      </div>

      {loading && <div role="status" aria-live="polite" className="mb-4 flex items-center gap-2 text-xs font-normal text-slate-500"><LoaderCircle size={16} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /><span className="min-w-0 break-words">Powered by Nebius X {mode === 'deep' ? 'Nvidia/Nemotron-3-Ultra-550b-a55b' : 'NVIDIA-Nemotron-3-Nano-30B-A3B'}</span></div>}

      {mode === 'deep' && <div className="mb-4 space-y-2">{peers.map((peer, index) => <div key={index} className="grid grid-cols-[1fr_70px] gap-2">
        <label className="min-w-0 text-xs text-slate-500">{index === 0 ? (zh ? '產業關聯參考' : 'Industry reference') : (zh ? '同業比較參考' : 'Peer reference')} <span className="text-[10px] text-slate-400">Optional</span>
          <input aria-label={index === 0 ? 'Industry reference symbol' : 'Peer reference symbol'} value={peer.symbol} disabled={loading || translating} maxLength={20} onChange={event => setPeers(current => current.map((item, i) => i === index ? { ...item, symbol: event.target.value.toUpperCase() } : item))} className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-2 text-base text-slate-900" />
        </label>
        <label className="text-xs text-slate-500">{zh ? '市場' : 'Market'}<select aria-label={`Comparison market ${index + 1}`} value={peer.market} disabled={loading || translating} onChange={event => setPeers(current => current.map((item, i) => i === index ? { ...item, market: event.target.value as 'US' | 'TW' } : item))} className="mt-1 h-10 w-full rounded border border-slate-300 bg-white text-base text-slate-900"><option value="US">US</option><option value="TW">TW</option></select></label>
      </div>)}</div>}


      {(answer || loading || analysisError) && (
        <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
          {!analysisError && <div className="ai-report-divider mb-4 flex items-center justify-between gap-2 border-b pb-3"><h3 className="text-lg font-bold text-slate-900">{answerLanguage === 'zh' ? 'AI 分析' : 'AI analysis'}</h3>
            <button type="button" disabled={loading || translating || !report} onClick={translateCurrent} aria-label={answerLanguage === 'zh' ? (zh ? '翻譯成英文' : 'Translate to English') : (zh ? '翻譯成中文' : 'Translate to Chinese')} title={answerLanguage === 'zh' ? (zh ? '翻譯成英文' : 'Translate to English') : (zh ? '翻譯成中文' : 'Translate to Chinese')} aria-busy={translating} className="flex h-9 shrink-0 items-center gap-1 rounded px-2 text-slate-900 hover:bg-slate-100 disabled:opacity-40">{translating ? <LoaderCircle size={18} className="animate-spin" /> : <Languages size={18} />}<span className="text-[9px] font-semibold">{answerLanguage === 'zh' ? 'EN' : '中'}</span></button>
          </div>}
          {translationError && <p role="alert" className="mb-3 text-xs text-rose-600">{translationError}</p>}
          {analysisError ? <div role="alert"><p>{analysisError}</p><button type="button" onClick={submitAnalysis} disabled={loading || translating} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded border border-slate-300 px-3 text-xs font-semibold text-slate-900 hover:bg-slate-100"><RotateCcw size={15} />{zh ? '重新分析' : 'Retry analysis'}</button></div> : loading && !answer ? (
            <span className="inline-flex items-center gap-2 text-slate-500">
              {t("analyzing")}
            </span>
          ) : (
            <AIAnswer text={answer} detailed={context?.mode === 'deep'} loading={loading} report={report} answerLanguage={answerLanguage} />
          )}
          {!analysisError && context?.mode === 'deep' && <div className="mt-4 space-y-2 text-xs text-slate-500">{evidence}</div>}
          {!analysisError && context?.mode === 'deep' && model && <p className="mt-2 truncate text-[10px] text-slate-400">Model: {model}</p>}
        </div>
      )}

      <p className="mt-2 text-[10px] leading-4 text-slate-400">{t("disclaimer")}</p>
    </section>
  );
}
