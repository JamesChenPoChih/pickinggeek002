import { ChartNoAxesCombined, Home, Search, UserRound } from "lucide-react";
import { useLanguage, type MessageKey } from "../../i18n";

export type TabId = "index" | "stocks" | "search" | "me";
interface BottomNavProps { active: TabId; onChange: (tab: TabId) => void }

const tabs = [
  { id: "stocks" as const, label: "index" as MessageKey, icon: Home },
  { id: "index" as const, label: "myStock" as MessageKey, icon: ChartNoAxesCombined },
  { id: "search" as const, label: "search" as MessageKey, icon: Search },
  { id: "me" as const, label: "me" as MessageKey, icon: UserRound },
];

export default function BottomNav({ active, onChange }: BottomNavProps) {
  const { t } = useLanguage();
  function switchTab(id: TabId) {
    if (id === active) return;
    try {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(40);
    } catch {
      // Haptic feedback must never prevent navigation.
    }
    onChange(id);
  }
  return (
    <nav className="app-bottom-nav sticky bottom-0 z-20 grid grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur" aria-label={t("bottomNavigation")}>
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => switchTab(id)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-black transition hover:bg-slate-50 ${active === id ? "nav-active" : "nav-inactive"}`}><Icon size={22} strokeWidth={active === id ? 3.2 : 1.8} /><span className={active === id ? "text-[11px] font-black" : "text-[10px] font-medium"}>{t(label)}</span></button>)}
    </nav>
  );
}
