import { useLanguage } from '../../i18n';
import type { QuickReport, DetailedReport } from '../../api';

interface AIAnswerProps { text: string; detailed?: boolean; loading?: boolean; report?: QuickReport | DetailedReport; answerLanguage?: 'zh' | 'en' }

const heading = /^(?:\*\*)?(總結|AI\s*分析|技術面|建議操作策略|新聞面|AI\s*綜合解讀|比較標的分析|綜合判斷與風險|近期新聞|新聞(?:分析|摘要)?|MA|MACD|Bollinger Bands|Squeeze|Summary|AI analysis|Technical analysis|Suggested strategy|AI interpretation|Comparison analysis|Comparative analysis|Overall assessment and risks|News(?: analysis| summary)?)(?:\*\*)?(?:[：:]\s*|$)(.*)$/i;

type SectionKey = 'summary' | 'technical' | 'ma' | 'macd' | 'bollinger' | 'squeeze' | 'strategy' | 'news';
const sectionKeys: Record<string, SectionKey> = {
  '總結': 'summary', summary: 'summary', '技術面': 'technical', 'technical analysis': 'technical',
  ma: 'ma', macd: 'macd', 'bollinger bands': 'bollinger', squeeze: 'squeeze',
  '建議操作策略': 'strategy', 'suggested strategy': 'strategy', '新聞面': 'news', 'news analysis': 'news',
};

export default function AIAnswer({ text, detailed = false, loading = false, report, answerLanguage }: AIAnswerProps) {
  const { language: uiLanguage } = useLanguage();
  const language = answerLanguage ?? uiLanguage;
  if (detailed || report) {
    const parts: Record<SectionKey, string[]> = { summary: [], technical: [], ma: [], macd: [], bollinger: [], squeeze: [], strategy: [], news: [] };
    let current: SectionKey = 'summary';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim().replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '');
      if (!line || line === '此內容僅供研究參考，不構成投資建議。' || /^Research only; not investment advice[.。]?$/i.test(line)) continue;
      const match = line.match(heading);
      if (match && /^(AI\s*分析|AI analysis)$/i.test(match[1])) continue;
      const key = match && sectionKeys[match[1].toLowerCase()];
      if (key) {
        current = key;
        if (match[2]) parts[current].push(match[2]);
      } else parts[current].push(raw);
    }
    if (report) {
      parts.technical = [];
      for (const key of ['summary', 'ma', 'macd', 'bollinger', 'squeeze'] as const) parts[key] = [report[key]];
      if ('strategy' in report) { parts.strategy = [report.strategy]; parts.news = [report.news]; }
    }
    const zh = language === 'zh';
    const body = (key: SectionKey) => parts[key].length ? <p className="mt-2 whitespace-pre-wrap">{parts[key].join('\n\n')}</p>
      : !loading ? <p className="mt-2 text-xs text-slate-400">{zh ? '本次回答未提供此項分析。' : 'This analysis was not provided in the response.'}</p> : null;
    return <div className="space-y-5 break-words" data-detailed-answer>
      <section><strong className="block font-bold text-slate-900">{zh ? '總結' : 'Summary'}</strong>{body('summary')}</section>
      <section><strong className="block font-bold text-slate-900">{zh ? '技術面' : 'Technical analysis'}</strong>{parts.technical.length > 0 && body('technical')}
        <div className="mt-3 space-y-4">{([['ma', 'MA'], ['macd', 'MACD'], ['bollinger', 'Bollinger Bands'], ['squeeze', 'Squeeze']] as const).map(([key, title]) => <div key={key}><strong className="block text-xs font-bold text-slate-900">{title}</strong>{body(key)}</div>)}</div>
      </section>
      {detailed && <><section><strong className="block font-bold text-slate-900">{zh ? '建議操作策略' : 'Suggested strategy'}</strong>{body('strategy')}</section>
      <section><strong className="block font-bold text-slate-900">{zh ? '新聞面' : 'News analysis'}</strong>{body('news')}</section>
      {!loading && <p className="text-xs text-slate-400">{zh ? '此內容僅供研究參考，不構成投資建議。' : 'Research only; not investment advice.'}</p>}</>}
    </div>;
  }
  return <div className="space-y-3 break-words">{text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    const match = line.trim().match(heading);
    return match ? <div key={index}><strong className="block font-bold text-slate-900">{match[1]}</strong>{match[2] && <p className="mt-1 whitespace-pre-wrap">{match[2]}</p>}</div>
      : <p key={index} className="whitespace-pre-wrap">{line}</p>;
  })}</div>;
}
