import { useEffect, useState } from 'react';
import { Download, RefreshCcw } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { applyPwaUpdate, installApp, installPrompt, pwaRegistration } from '../../pwa';

export default function PwaInstall() {
  const { language } = useLanguage();
  const zh = language === 'zh';
  const [, refresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const standalone = matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  useEffect(() => {
    const update = () => refresh(value => value + 1);
    const mode = matchMedia('(display-mode: standalone)');
    window.addEventListener('pickinggeek:pwa', update);
    mode.addEventListener('change', update);
    return () => { window.removeEventListener('pickinggeek:pwa', update); mode.removeEventListener('change', update); };
  }, []);
  return <section className="mx-5 mb-5 border-y border-slate-200 py-3">
    <button type="button" disabled={!installPrompt || busy || standalone} onClick={async () => {
      setBusy(true); setError(false);
      try { await installApp(); } catch { setError(true); } finally { setBusy(false); }
    }} className="flex min-h-11 w-full items-center gap-3 text-left text-slate-900 disabled:text-slate-400">
      <Download size={17} /><span className="text-xs font-semibold">{standalone ? (zh ? 'APP 模式' : 'App mode') : installPrompt ? (zh ? '安裝 Picking Geek' : 'Install Picking Geek') : (zh ? '瀏覽器未提供安裝選項' : 'Browser install unavailable')}</span>
    </button>
    {error && <p role="status" className="text-xs text-rose-600">{zh ? '無法開啟安裝視窗' : 'Installation prompt unavailable'}</p>}
    {pwaRegistration?.waiting && <button type="button" onClick={applyPwaUpdate} className="flex min-h-11 w-full items-center gap-3 text-left text-slate-900"><RefreshCcw size={17} /><span className="text-xs font-semibold">{zh ? '更新 APP' : 'Update app'}</span></button>}
  </section>;
}
