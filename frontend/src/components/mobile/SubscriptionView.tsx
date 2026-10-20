import { useCallback, useEffect, useState } from "react";
import { CreditCard, ExternalLink, RefreshCcw } from "lucide-react";
import { billingRequest, type BillingState } from "../../api";
import { useLanguage } from "../../i18n";

export default function SubscriptionView() {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [state, setState] = useState<BillingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const next = await billingRequest<BillingState>("", {});
      setState(next);
      window.dispatchEvent(new CustomEvent("pickinggeek:billing-updated", { detail: next.user }));
    } catch (e) { setError(e instanceof Error ? e.message : "Billing unavailable"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function redirect(path: string, body: object = {}) {
    setBusy(true); setError("");
    try {
      const result = await billingRequest<{ url: string }>(path, body);
      window.location.assign(result.url);
    } catch (e) { setError(e instanceof Error ? e.message : "Billing unavailable"); setBusy(false); }
  }
  const subscribed = state?.has_subscription && !["canceled", "incomplete_expired"].includes(state.status);
  const button = "flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 disabled:opacity-50";
  return <div className="space-y-4" aria-busy={busy}>
    <p className="text-xs font-semibold text-slate-600">{zh ? "Stripe 測試環境 · 不會扣取真實款項" : "Stripe sandbox · No real charges"}</p>
    {new URLSearchParams(window.location.search).get("billing") === "cancel" && <p className="text-sm text-slate-600">{zh ? "付款流程已取消，方案未變更。" : "Checkout canceled. Your plan has not changed."}</p>}
    {state && !state.configured && <p role="status" className="text-sm text-slate-600">{zh ? "尚未完成 Stripe sandbox 設定，暫時無法付款。" : "Stripe sandbox setup is incomplete. Payments are unavailable."}</p>}
    {error && <p role="alert" className="break-words text-sm text-red-600">{error}</p>}
    {!state && busy && <p role="status" className="text-sm">{zh ? "讀取訂閱中…" : "Loading subscription…"}</p>}
    {([{ tier: "FREE", name: "Basic", price: "$0" }, { tier: "PRO", name: "Pro", price: "$9.99" }, { tier: "PREMIUM", name: "Premium", price: "$39.99" }] as const).map((plan) => {
      const current = state?.user.tier === plan.tier;
      return <section key={plan.tier} className={`rounded-md border bg-white p-4 ${current ? "border-emerald-600" : "border-slate-200"}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-base font-bold text-slate-950">{plan.name}</h2><p className="text-base font-semibold text-slate-900">US{plan.price}<span className="text-xs font-normal text-slate-500">{plan.tier === "FREE" ? "" : zh ? " / 月" : " / month"}</span></p></div>
        <p className="my-3 text-xs text-slate-500">{zh ? "可追蹤無限支股票" : "Unlimited tracked stocks"}{plan.tier === "FREE" && (zh ? " · Alert 最多 5 支股票" : " · Alerts for up to 5 stocks")}</p>
        <button type="button" disabled={busy || !state || current || (plan.tier === "FREE" ? !subscribed : !state.configured)} onClick={() => void redirect(subscribed || plan.tier === "FREE" ? "portal/" : "checkout/", { tier: plan.tier })} className={`${button} w-full`}>
          <CreditCard size={16} />{current ? (zh ? "目前方案" : "Current plan") : subscribed ? (zh ? "管理訂閱 / 變更方案" : "Manage / change subscription") : plan.tier === "FREE" ? (zh ? "免費方案" : "Free plan") : (zh ? "訂閱" : "Subscribe")}
        </button>
      </section>;
    })}
    {state && <div className="text-xs leading-6 text-slate-600">
      <p>{zh ? "訂閱狀態：" : "Subscription: "}{state.status === "none" ? (zh ? "無付費訂閱" : "No paid subscription") : state.status}</p>
      {state.period_end && <p>{state.cancel_at_period_end ? (zh ? "到期取消：" : "Cancels on: ") : (zh ? "目前週期結束：" : "Current period ends: ")}{new Date(state.period_end * 1000).toLocaleDateString(zh ? "zh-TW" : "en-US")}</p>}
    </div>}
    <button type="button" disabled={busy} onClick={() => void refresh()} className={`${button} w-full`}><RefreshCcw size={16} />{zh ? "重新確認訂閱" : "Refresh subscription"}</button>
    {state?.has_customer && <button type="button" disabled={busy || !state.configured} onClick={() => void redirect("portal/")} className={`${button} w-full`}><ExternalLink size={16} />{zh ? "管理訂閱與帳單" : "Manage subscription & invoices"}</button>}
  </div>;
}
