import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Language = "zh" | "en";

const messages = {
  zh: {
    notification: "通知", switchLanguage: "切換為英文", proInvestor: "專業投資人", freePlan: "免費方案",
    index: "首頁", myStock: "自選股", stockPage: "My Stock", aiInvest: "AI Invest", search: "搜尋", me: "我的",
    selectStock: "選擇股票", removeStock: "移除", removingStock: "移除中…", removeStockFailed: "無法移除股票，請稍後再試", keepOneStock: "請至少保留一支股票", priceTrend: "真實價格走勢", closeAndAverages: "Yahoo Finance 行情", price: "價格", chartLabel: "真實價格走勢圖", chartLoading: "正在載入真實行情…", chartUnavailable: "目前無法取得 Yahoo Finance 行情", chartRetry: "重新載入", previousClose: "前收", periodStart: "區間起點", marketData: "市場行情",
    technicalIndicators: "技術指標", liveStatus: "即時狀態", pendingUpdate: "等待每日更新", momentum: "動能指標", macdStatus: "MACD 狀態", histogram: "柱狀圖", movingAverages: "移動平均線", averageSignal: "均線訊號", above: "站上",
    aiAnalysis: "AI 投資分析", technicalCopilot: "技術面 Copilot", analysisMode: "分析模式", quickAnswer: "Pro Model", deepReport: "Ultra Model", analyzing: "正在分析市場資料…", askStock: "詢問這支股票…", sendAnalysis: "送出分析", disclaimer: "AI 內容僅供研究參考，不構成投資建議。", defaultQuestion: "請幫我做AI分析", aiUnavailable: "AI 分析暫時無法使用，請稍後再試。",
    brandName: "Picking Geek", todayMarket: "今日市場", trackedAssets: "追蹤標的", bullishSignals: "偏多訊號", marketSnapshot: "市場快照",
    searchStocks: "搜尋投資商品", searchPlaceholder: "輸入代號或英文名稱", searchHint: "美股盤前／盤中／盤後，Bitcoin 24/7 即時行情", popularStocks: "熱門市場", searching: "正在載入 24/7 市場行情…", noSearchResults: "找不到符合的投資商品", searchFailed: "市場搜尋暫時無法使用，請確認登入狀態", marketPre: "盤前", marketOpen: "盤中", marketPost: "盤後", marketClosed: "休市", market24h: "24/7 交易中", priceUnavailable: "價格暫時無法取得", addToMyStock: "加入 My Stock", alreadyTracked: "已加入 My Stock", addStockFailed: "無法加入 My Stock，請稍後再試", openYahoo: "在 Yahoo Finance 查看", localStock: "已加入 Picking Geek", assetStock: "股票", assetEtf: "ETF", assetGold: "黃金", assetBitcoin: "Bitcoin", proPlan: "Pro 方案", unlimitedStocks: "可追蹤無限支股票", logout: "登出",
    welcomeBack: "歡迎回來", loginSubtitle: "使用 Gmail 帳號登入，立即查看自選股訊號與 AI 市場分析。", username: "使用者名稱", password: "密碼", loggingIn: "登入中…", login: "登入", or: "或", googleSignIn: "使用 Google 帳號繼續", orUsePassword: "或使用帳號密碼", googleUnavailable: "Google 登入尚未完成服務設定，請先使用帳號密碼。", googleLoggingIn: "正在使用 Google 登入…", googleLoginFailed: "Google 登入失敗，請稍後再試。", secureTransfer: "資料以安全連線傳輸", loginFailed: "登入失敗，請確認帳號密碼。", bottomNavigation: "底部導覽",
  },
  en: {
    notification: "Notifications", switchLanguage: "Switch to Chinese", proInvestor: "Pro investor", freePlan: "Free plan",
    index: "Index", myStock: "My Stock", stockPage: "My Stock", aiInvest: "AI Invest", search: "Search", me: "Me",
    selectStock: "Select stock", removeStock: "Remove", removingStock: "Removing…", removeStockFailed: "Could not remove this stock. Please try again.", keepOneStock: "Keep at least one stock", priceTrend: "Real price trend", closeAndAverages: "Yahoo Finance market data", price: "Price", chartLabel: "real price chart", chartLoading: "Loading real market data…", chartUnavailable: "Yahoo Finance market data is unavailable", chartRetry: "Try again", previousClose: "Previous close", periodStart: "Period start", marketData: "Market data",
    technicalIndicators: "Technical indicators", liveStatus: "Live status", pendingUpdate: "Awaiting daily update", momentum: "Momentum", macdStatus: "MACD status", histogram: "Histogram", movingAverages: "Moving averages", averageSignal: "Moving average signal", above: "Above",
    aiAnalysis: "AI investment analysis", technicalCopilot: "Technical Copilot", analysisMode: "Analysis mode", quickAnswer: "Pro Model", deepReport: "Ultra Model", analyzing: "Analyzing market data…", askStock: "Ask about this stock…", sendAnalysis: "Send analysis", disclaimer: "AI content is for research only and is not investment advice.", defaultQuestion: "Please provide an AI analysis", aiUnavailable: "AI analysis is temporarily unavailable. Please try again.",
    brandName: "PICKING GEEK", todayMarket: "Today's market", trackedAssets: "Tracked assets", bullishSignals: "Bullish signals", marketSnapshot: "Market snapshot",
    searchStocks: "Search investments", searchPlaceholder: "Enter a symbol or English name", searchHint: "US pre-market, regular and after-hours; Bitcoin 24/7", popularStocks: "Popular markets", searching: "Loading 24/7 market prices…", noSearchResults: "No matching investments found", searchFailed: "Market search is unavailable. Check your sign-in status.", marketPre: "Pre-market", marketOpen: "Market open", marketPost: "After-hours", marketClosed: "Market closed", market24h: "Trading 24/7", priceUnavailable: "Price unavailable", addToMyStock: "Add to My Stock", alreadyTracked: "Already in My Stock", addStockFailed: "Could not add this investment. Please try again.", openYahoo: "View on Yahoo Finance", localStock: "Available in Picking Geek", assetStock: "Stock", assetEtf: "ETF", assetGold: "Gold", assetBitcoin: "Bitcoin", proPlan: "Pro plan", unlimitedStocks: "Track unlimited stocks", logout: "Log out",
    welcomeBack: "Welcome back", loginSubtitle: "Continue with Gmail to view watchlist signals and AI market analysis.", username: "Username", password: "Password", loggingIn: "Signing in…", login: "Sign in", or: "OR", googleSignIn: "Continue with Google", orUsePassword: "or use username and password", googleUnavailable: "Google sign-in is not configured yet. Use your username and password for now.", googleLoggingIn: "Signing in with Google…", googleLoginFailed: "Google sign-in failed. Please try again.", secureTransfer: "Data is transmitted securely", loginFailed: "Sign-in failed. Check your username and password.", bottomNavigation: "Bottom navigation",
  },
} as const;

export type MessageKey = keyof typeof messages.zh;
interface LanguageContextValue { language: Language; toggleLanguage: () => void; t: (key: MessageKey) => string }

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem("pickinggeek_language") === "en" ? "en" : "zh");
  const value = useMemo<LanguageContextValue>(() => ({
    language,
    toggleLanguage: () => setLanguage((current) => {
      const next = current === "zh" ? "en" : "zh";
      localStorage.setItem("pickinggeek_language", next);
      document.documentElement.lang = next === "zh" ? "zh-TW" : "en";
      return next;
    }),
    t: (key) => messages[language][key],
  }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider");
  return context;
}
