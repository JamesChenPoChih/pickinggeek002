import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft, Bell, ChevronRight, CircleHelp, Cloud, CreditCard, Database,
  FileCode2, FileText, Globe2, Headphones, KeyRound, Languages, LogOut,
  Mail, Moon, Pencil, RefreshCcw, ShieldCheck, Smartphone, Sun, Trash2,
  Upload, UserRound, WalletCards, type LucideIcon,
} from "lucide-react";

import { useLanguage } from "../../i18n";
import SubscriptionView from "./SubscriptionView";
import type { StockAppSchema } from "../../types/stock";

type Screen = "main" | "profile" | "subscription" | "history" | "security" | "settings" | "support" | "about";
type ThemeMode = "light" | "dark" | "system";

const copy = {
  zh: {
    me: "我的", editProfile: "編輯個人資料", proMember: "Pro 尊享會員", freeMember: "免費版",
    subscription: "方案與訂閱", managePlan: "方案升級 / 訂閱管理", restore: "恢復購買", history: "購買與訂閱紀錄",
    security: "帳戶與安全", linkedAccounts: "綁定帳號、密碼與帳戶管理", settings: "系統與隱私設定",
    appearance: "外觀模式", language: "語言", notifications: "推播通知設定", privacy: "隱私與權限管理",
    support: "幫助與支援", faq: "常見問題與說明中心", feedback: "意見與問題反饋", contact: "聯絡客服 / 線上客服", status: "系統服務狀態",
    aboutSystem: "關於與維運", about: "關於 Picking Geek", updates: "檢查更新", cache: "清除快取", terms: "使用條款", policy: "隱私政策", licenses: "第三方開源聲明", logout: "登出",
    back: "返回", displayName: "暱稱", accountId: "帳號 / ID", save: "儲存變更", saved: "已儲存",
    basic: "Basic", pro: "Pro", premium: "Premium", current: "目前方案", choose: "選擇方案", restored: "購買紀錄已恢復", noPurchase: "尚無額外購買紀錄",
    email: "Email", apple: "Apple ID", google: "Google", bound: "已綁定", notBound: "未綁定", changePassword: "修改密碼", newPassword: "新密碼", verification: "安全驗證碼", updatePassword: "更新密碼", passwordUpdated: "密碼更新請求已建立", deleteAccount: "刪除 / 註銷帳號", deleteWarning: "此操作將永久刪除帳戶與自選股資料。", confirmDelete: "我了解風險，繼續", cancel: "取消", deletionPrepared: "刪除功能需在正式環境完成身分驗證。",
    light: "淺色", dark: "深色", system: "跟隨系統", priceAlerts: "價格與技術訊號", aiReports: "AI 分析完成通知", marketing: "產品消息", camera: "相機", photos: "相冊", tracking: "追蹤授權", allowed: "允許", askNextTime: "下次詢問",
    faqOne: "Picking Geek 的訊號是投資建議嗎？", faqOneAnswer: "不是。所有訊號與 AI 內容僅供研究參考，投資決策仍需自行判斷。", faqTwo: "行情多久更新一次？", faqTwoAnswer: "首頁即時價格每 2 秒更新，技術指標則依每日收盤批次更新。", feedbackTitle: "標題", feedbackBody: "請描述問題或建議", attachImage: "附加圖片", sendFeedback: "送出意見", feedbackSent: "感謝您的意見，我們已收到。", online: "服務正常", version: "目前版本 v0.1.0", latest: "目前已是最新版本", checking: "檢查中…", cacheCleared: "快取已清除", aboutText: "Picking Geek 是結合真實行情、技術指標與 AI 分析的個人投資 Copilot。", legalText: "此頁為 Hackathon 版本內容；正式上線前將提供完整法律文件。",
  },
  en: {
    me: "Me", editProfile: "Edit profile", proMember: "Pro member", freeMember: "Free plan",
    subscription: "Plan & subscription", managePlan: "Upgrade / manage plan", restore: "Restore purchases", history: "Purchase & subscription history",
    security: "Account & security", linkedAccounts: "Linked accounts, password and account controls", settings: "System & privacy settings",
    appearance: "Appearance", language: "Language", notifications: "Notification settings", privacy: "Privacy & permissions",
    support: "Help & support", faq: "FAQ & help center", feedback: "Feedback & issue report", contact: "Contact support / live chat", status: "System status",
    aboutSystem: "About & system", about: "About Picking Geek", updates: "Check for updates", cache: "Clear cache", terms: "Terms of Service", policy: "Privacy Policy", licenses: "Open source licenses", logout: "Log out",
    back: "Back", displayName: "Display name", accountId: "Account / ID", save: "Save changes", saved: "Saved",
    basic: "Basic", pro: "Pro", premium: "Premium", current: "Current plan", choose: "Choose plan", restored: "Purchases restored", noPurchase: "No additional purchase history",
    email: "Email", apple: "Apple ID", google: "Google", bound: "Linked", notBound: "Not linked", changePassword: "Change password", newPassword: "New password", verification: "Security code", updatePassword: "Update password", passwordUpdated: "Password update request created", deleteAccount: "Delete account", deleteWarning: "This permanently deletes your account and watchlist data.", confirmDelete: "I understand, continue", cancel: "Cancel", deletionPrepared: "Identity verification is required in the production app.",
    light: "Light", dark: "Dark", system: "System", priceAlerts: "Price & technical signals", aiReports: "AI report completion", marketing: "Product news", camera: "Camera", photos: "Photos", tracking: "Tracking permission", allowed: "Allowed", askNextTime: "Ask next time",
    faqOne: "Are Picking Geek signals investment advice?", faqOneAnswer: "No. Signals and AI content are for research only. You remain responsible for investment decisions.", faqTwo: "How often does market data update?", faqTwoAnswer: "Home prices refresh every 2 seconds. Technical indicators update after the daily close.", feedbackTitle: "Title", feedbackBody: "Describe the issue or suggestion", attachImage: "Attach image", sendFeedback: "Send feedback", feedbackSent: "Thanks. Your feedback has been received.", online: "All systems operational", version: "Current version v0.1.0", latest: "You are on the latest version", checking: "Checking…", cacheCleared: "Cache cleared", aboutText: "Picking Geek is a personal investment Copilot combining live market data, technical indicators and AI analysis.", legalText: "This is Hackathon-version content. Complete legal documents will be provided before launch.",
  },
} as const;

interface MeViewProps { user: StockAppSchema["user"]; onLogout: () => void }

function SettingRow({ icon: Icon, label, value, danger = false, onClick }: { icon: LucideIcon; label: string; value?: string; danger?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-12 w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50">
    <Icon size={17} className={danger ? "text-rose-600" : "text-slate-500"} />
    <span className={`min-w-0 flex-1 text-sm font-medium ${danger ? "text-rose-700" : "text-slate-800"}`}>{label}</span>
    {value && <span className="max-w-28 truncate text-[10px] text-slate-400">{value}</span>}
    <ChevronRight size={15} className="shrink-0 text-slate-300" />
  </button>;
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-6"><h2 className="mb-2 px-5 text-[11px] font-bold uppercase text-slate-400">{title}</h2><div className="divide-y divide-slate-100 border-y border-slate-100 bg-white">{children}</div></section>;
}

function DetailPage({ title, back, children }: { title: string; back: () => void; children: React.ReactNode }) {
  const { language } = useLanguage();
  const c = copy[language];
  return <div className="min-h-full bg-slate-50"><div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4"><button type="button" onClick={back} aria-label={c.back} className="grid size-9 place-items-center rounded-md text-slate-600 hover:bg-slate-100"><ArrowLeft size={19} /></button><h1 className="text-base font-bold text-slate-950">{title}</h1></div><div className="px-5 py-5">{children}</div></div>;
}

export default function MeView({ user, onLogout }: MeViewProps) {
  const { language, toggleLanguage } = useLanguage();
  const c = copy[language];
  const [screen, setScreen] = useState<Screen>(() => new URLSearchParams(window.location.search).has("billing") ? "subscription" : "main");
  const [name, setName] = useState(() => localStorage.getItem("pickinggeek_profile_name") || user.name);
  const [handle, setHandle] = useState(() => localStorage.getItem("pickinggeek_profile_handle") || user.handle);
  const [profileSaved, setProfileSaved] = useState(false);
  const plan = user.tier;
  const [message, setMessage] = useState("");
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem("pickinggeek_theme") as ThemeMode) || "system");
  const [alerts, setAlerts] = useState({ price: true, ai: true, marketing: false });
  const [checking, setChecking] = useState(false);
  const [deleteStep, setDeleteStep] = useState(false);

  useEffect(() => {
    localStorage.setItem("pickinggeek_theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const cacheSize = useMemo(() => {
    let bytes = 0;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) || "";
      if (key.startsWith("pickinggeek_cache_")) bytes += (localStorage.getItem(key) || "").length * 2;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }, [message]);

  function saveProfile(event: FormEvent) {
    event.preventDefault();
    localStorage.setItem("pickinggeek_profile_name", name.trim());
    localStorage.setItem("pickinggeek_profile_handle", handle.trim());
    setProfileSaved(true);
  }

  if (screen === "profile") return <DetailPage title={c.editProfile} back={() => setScreen("main")}><form onSubmit={saveProfile} className="space-y-4"><label className="block text-xs font-semibold text-slate-600">{c.displayName}<input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-600" /></label><label className="block text-xs font-semibold text-slate-600">{c.accountId}<input value={handle} onChange={(event) => setHandle(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-600" /></label><button className="h-11 w-full rounded-md bg-slate-950 text-sm font-bold text-white" type="submit">{profileSaved ? c.saved : c.save}</button></form></DetailPage>;

  if (screen === "subscription" || screen === "history") return <DetailPage title={screen === "history" ? c.history : c.subscription} back={() => setScreen("main")}><SubscriptionView /></DetailPage>;


  if (screen === "security") return <DetailPage title={c.security} back={() => setScreen("main")}><div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white"><InfoRow label={c.email} value={`demo@pickinggeek.local · ${c.bound}`} /><InfoRow label={c.apple} value={c.notBound} /><InfoRow label={c.google} value={c.notBound} /></div><h2 className="mb-3 mt-6 text-sm font-bold text-slate-900">{c.changePassword}</h2><div className="space-y-3"><input type="password" placeholder={c.newPassword} className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /><input inputMode="numeric" placeholder={c.verification} className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /><button type="button" onClick={() => setMessage(c.passwordUpdated)} className="h-10 w-full rounded-md bg-slate-950 text-sm font-semibold text-white">{c.updatePassword}</button>{message && <p className="text-xs text-emerald-600">{message}</p>}</div><div className="mt-8 border-t border-rose-100 pt-5"><h2 className="text-sm font-bold text-rose-700">{c.deleteAccount}</h2><p className="mt-1 text-xs leading-5 text-rose-600">{c.deleteWarning}</p>{!deleteStep ? <button type="button" onClick={() => setDeleteStep(true)} className="mt-3 h-9 rounded-md border border-rose-300 px-3 text-xs font-bold text-rose-700">{c.confirmDelete}</button> : <div className="mt-3 rounded-md bg-rose-50 p-3"><p className="text-xs text-rose-700">{c.deletionPrepared}</p><button type="button" onClick={() => setDeleteStep(false)} className="mt-2 text-xs font-bold text-slate-600">{c.cancel}</button></div>}</div></DetailPage>;

  if (screen === "settings") return <DetailPage title={c.settings} back={() => setScreen("main")}><h2 className="mb-3 text-sm font-bold text-slate-900">{c.appearance}</h2><div className="grid grid-cols-3 gap-2">{([{ id: "light", label: c.light, icon: Sun }, { id: "dark", label: c.dark, icon: Moon }, { id: "system", label: c.system, icon: Smartphone }] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setTheme(id)} className={`flex h-16 flex-col items-center justify-center gap-1 rounded-md border text-[10px] font-semibold ${theme === id ? "border-sky-600 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600"}`}><Icon size={17} />{label}</button>)}</div><button type="button" onClick={toggleLanguage} className="mt-5 flex h-11 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 text-sm"><span className="flex items-center gap-2"><Languages size={17} />{c.language}</span><strong>{language === "zh" ? "繁體中文" : "English"}</strong></button><h2 className="mb-2 mt-6 text-sm font-bold text-slate-900">{c.notifications}</h2><div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white"><ToggleRow label={c.priceAlerts} checked={alerts.price} onChange={() => setAlerts((value) => ({ ...value, price: !value.price }))} /><ToggleRow label={c.aiReports} checked={alerts.ai} onChange={() => setAlerts((value) => ({ ...value, ai: !value.ai }))} /><ToggleRow label={c.marketing} checked={alerts.marketing} onChange={() => setAlerts((value) => ({ ...value, marketing: !value.marketing }))} /></div><h2 className="mb-2 mt-6 text-sm font-bold text-slate-900">{c.privacy}</h2><div className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white"><InfoRow label={c.camera} value={c.askNextTime} /><InfoRow label={c.photos} value={c.askNextTime} /><InfoRow label={c.tracking} value={c.allowed} /></div></DetailPage>;

  if (screen === "support") return <DetailPage title={c.support} back={() => setScreen("main")}><div className="space-y-2"><details className="rounded-md border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">{c.faqOne}</summary><p className="mt-2 text-xs leading-5 text-slate-500">{c.faqOneAnswer}</p></details><details className="rounded-md border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">{c.faqTwo}</summary><p className="mt-2 text-xs leading-5 text-slate-500">{c.faqTwoAnswer}</p></details></div><FeedbackForm c={c} /><a href="mailto:support@pickinggeek.app" className="mt-5 flex h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-700"><Headphones size={17} />{c.contact}</a><div className="mt-5 flex items-center justify-between rounded-md border border-slate-200 bg-white p-4"><span className="flex items-center gap-2 text-sm font-semibold"><Cloud size={17} className="text-emerald-600" />{c.status}</span><span className="text-[10px] font-bold text-emerald-600">{c.online}</span></div></DetailPage>;

  if (screen === "about") return <DetailPage title={c.aboutSystem} back={() => setScreen("main")}><p className="text-sm leading-6 text-slate-600">{c.aboutText}</p><div className="mt-5 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white"><InfoRow label={c.updates} value={checking ? c.checking : c.version} /><InfoRow label={c.cache} value={cacheSize} /></div><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => { setChecking(true); window.setTimeout(() => { setChecking(false); setMessage(c.latest); }, 500); }} className="h-10 rounded-md border border-slate-300 bg-white text-xs font-semibold">{c.updates}</button><button type="button" onClick={() => { Object.keys(localStorage).filter((key) => key.startsWith("pickinggeek_cache_")).forEach((key) => localStorage.removeItem(key)); setMessage(c.cacheCleared); }} className="h-10 rounded-md border border-slate-300 bg-white text-xs font-semibold">{c.cache}</button></div>{message && <p className="mt-3 text-center text-xs text-emerald-600">{message}</p>}<div className="mt-6 space-y-2">{[c.terms, c.policy, c.licenses].map((item) => <details key={item} className="rounded-md border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">{item}</summary><p className="mt-2 text-xs leading-5 text-slate-500">{c.legalText}</p></details>)}</div></DetailPage>;

  return <div className="pb-5">
    <section className="px-5 pb-5 pt-6"><div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-3"><div className="grid size-14 place-items-center rounded-full bg-sky-700 text-base font-black text-white">{name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><h1 className="truncate text-lg font-black text-slate-950">{name}</h1><p className="truncate text-xs text-slate-400">@{handle}</p><span className="mt-1 inline-flex rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{plan === "FREE" ? c.freeMember : plan === "PREMIUM" ? "Premium" : c.proMember}</span></div></div><button type="button" onClick={() => setScreen("profile")} className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-300 text-xs font-semibold text-slate-700"><Pencil size={14} />{c.editProfile}</button></div></section>
    <SettingsSection title={c.subscription}><SettingRow icon={CreditCard} label={c.managePlan} value={plan === "FREE" ? "Basic" : plan} onClick={() => setScreen("subscription")} /><SettingRow icon={RefreshCcw} label={language === "zh" ? "重新確認訂閱" : "Refresh subscription"} onClick={() => setScreen("subscription")} /><SettingRow icon={WalletCards} label={c.history} onClick={() => setScreen("history")} /></SettingsSection>
    <SettingsSection title={c.security}><SettingRow icon={ShieldCheck} label={c.security} value={c.linkedAccounts} onClick={() => setScreen("security")} /></SettingsSection>
    <SettingsSection title={c.settings}><SettingRow icon={Sun} label={c.appearance} value={theme === "light" ? c.light : theme === "dark" ? c.dark : c.system} onClick={() => setScreen("settings")} /><SettingRow icon={Languages} label={c.language} value={language === "zh" ? "繁體中文" : "English"} onClick={() => setScreen("settings")} /><SettingRow icon={Bell} label={c.notifications} onClick={() => setScreen("settings")} /><SettingRow icon={KeyRound} label={c.privacy} onClick={() => setScreen("settings")} /></SettingsSection>
    <SettingsSection title={c.support}><SettingRow icon={CircleHelp} label={c.faq} onClick={() => setScreen("support")} /><SettingRow icon={Upload} label={c.feedback} onClick={() => setScreen("support")} /><SettingRow icon={Headphones} label={c.contact} onClick={() => setScreen("support")} /><SettingRow icon={Cloud} label={c.status} value={c.online} onClick={() => setScreen("support")} /></SettingsSection>
    <SettingsSection title={c.aboutSystem}><SettingRow icon={UserRound} label={c.about} onClick={() => setScreen("about")} /><SettingRow icon={RefreshCcw} label={c.updates} value="v0.1.0" onClick={() => setScreen("about")} /><SettingRow icon={Database} label={c.cache} value={cacheSize} onClick={() => setScreen("about")} /><SettingRow icon={FileText} label={c.terms} onClick={() => setScreen("about")} /><SettingRow icon={Globe2} label={c.policy} onClick={() => setScreen("about")} /><SettingRow icon={FileCode2} label={c.licenses} onClick={() => setScreen("about")} /></SettingsSection>
    <div className="px-5 pt-7"><button type="button" onClick={onLogout} className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-rose-300 bg-white text-sm font-bold text-rose-700"><LogOut size={17} />{c.logout}</button></div>
  </div>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex min-h-11 items-center justify-between gap-3 px-3 py-2"><span className="text-xs font-semibold text-slate-700">{label}</span><span className="text-right text-[10px] text-slate-400">{value}</span></div>;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return <button type="button" onClick={onChange} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left"><span className="text-xs font-semibold text-slate-700">{label}</span><span className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-sky-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 size-4 rounded-full bg-white transition ${checked ? "left-[18px]" : "left-0.5"}`} /></span></button>;
}

function FeedbackForm({ c }: { c: typeof copy.zh | typeof copy.en }) {
  const [sent, setSent] = useState(false);
  return <form onSubmit={(event) => { event.preventDefault(); setSent(true); }} className="mt-6 space-y-3"><h2 className="text-sm font-bold text-slate-900">{c.feedback}</h2><input required placeholder={c.feedbackTitle} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" /><textarea required rows={4} placeholder={c.feedbackBody} className="w-full resize-none rounded-md border border-slate-300 bg-white p-3 text-sm" /><label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white text-xs font-semibold text-slate-600"><Upload size={15} />{c.attachImage}<input type="file" accept="image/*" className="sr-only" /></label><button type="submit" className="h-10 w-full rounded-md bg-slate-950 text-xs font-bold text-white">{c.sendFeedback}</button>{sent && <p className="text-xs text-emerald-600">{c.feedbackSent}</p>}</form>;
}
