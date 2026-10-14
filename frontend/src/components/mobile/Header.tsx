import { Languages } from "lucide-react";
import AlertNotifications from './AlertNotifications';
import { useLanguage } from "../../i18n";
import type { StockAppSchema } from "../../types/stock";

interface HeaderProps { user: StockAppSchema["user"] }

export default function Header({ user }: HeaderProps) {
  const { language, t, toggleLanguage } = useLanguage();
  const initials = user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 bg-white px-5">
      <div className="flex min-w-0 items-center gap-3">
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="size-9 rounded-full object-cover" />
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sky-700 text-xs font-bold text-white">{initials}</span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{user.handle}</p>
          <p className="text-[10px] text-slate-400">{user.tier === "PREMIUM" ? "Premium" : user.tier === "PRO" ? t("proInvestor") : t("freePlan")}</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={toggleLanguage} title={t("switchLanguage")} aria-label={t("switchLanguage")} className="relative grid size-9 place-items-center rounded-full text-slate-600 hover:bg-slate-100">
          <Languages size={19} /><span className="absolute -bottom-0.5 right-0 text-[8px] font-bold text-sky-700">{language === "zh" ? "EN" : "中"}</span>
        </button>
        <AlertNotifications />
      </div>
    </header>
  );
}
