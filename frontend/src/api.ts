import type { ChartRange, StockApiResponse, YahooChartResponse, YahooStockResult } from "./types/stock";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const ACCESS_KEY = "pickinggeek_access";
const REFRESH_KEY = "pickinggeek_refresh";
const AUTH_EXPIRED_EVENT = "pickinggeek:auth-expired";

export interface AuthUser {
  name: string;
  email: string;
  avatar: string;
  tier: "FREE" | "PRO" | "PREMIUM";
}

export interface AuthTokens { access: string; refresh: string; user?: AuthUser }
export interface BillingState {
  configured: boolean;
  sandbox: boolean;
  user: AuthUser;
  status: string;
  has_customer: boolean;
  has_subscription: boolean;
  cancel_at_period_end: boolean;
  period_end: number | null;
}

export async function billingRequest<T>(path = "", body?: object): Promise<T> {
  const response = await authorizedFetch(`${API_BASE}/billing/${path}`, localStorage.getItem(ACCESS_KEY) || "", {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Billing API responded ${response.status}`);
  return payload as T;
}
export type AnalysisMode = "auto" | "quick" | "deep";
export interface AnalysisUsage {
  limited: boolean;
  timezone?: string;
  resets_at?: string;
  quick?: { used: number; limit: number; remaining: number };
  deep?: { used: number; limit: number; remaining: number };
}
export async function fetchAnalysisUsage(token: string, signal?: AbortSignal): Promise<AnalysisUsage> {
  const response = await authorizedFetch(`${API_BASE}/ai/usage/`, token, { signal });
  if (!response.ok) throw new Error('Analysis usage unavailable');
  return response.json();
}
export interface AnalysisPeer { symbol: string; market: 'US' | 'TW'; role: 'industry' | 'peer' }
export interface AnalysisAsset {
  symbol: string; market: string; role: string; status: string; as_of?: string; close?: number; currency?: string;
  missing?: string[];
  news?: { status: string; window_days: number; items: { title: string; url: string; publisher: string; published_at: string }[] };
}
export interface AnalysisContext { target: AnalysisAsset; comparisons: AnalysisAsset[]; mode: string }
export interface DetailedReport { summary: string; ma: string; macd: string; bollinger: string; squeeze: string; strategy: string; news: string }
export type QuickReport = Pick<DetailedReport, 'summary' | 'ma' | 'macd' | 'bollinger' | 'squeeze'>;
export async function translateAnalysis(token: string, report: QuickReport | DetailedReport, language: 'zh' | 'en', signal?: AbortSignal): Promise<QuickReport | DetailedReport> {
  const response = await authorizedFetch(`${API_BASE}/ai/translate/`, token, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report, language }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || 'Translation unavailable');
  if (!payload.sections || Object.keys(report).some(key => typeof payload.sections[key] !== 'string' || !payload.sections[key].trim())) throw new Error('Incomplete translation');
  return payload.sections;
}
export interface BullishSummary {
  count: number; updated_at: string;
  stocks: { id: number; symbol: string; name: string; market: string; as_of: string | null; status: 'bullish' | 'neutral' | 'unavailable'; score: number | null; signals: Record<string, boolean> }[];
}
export async function fetchBullishSummary(token: string, signal?: AbortSignal): Promise<BullishSummary> {
  const response = await authorizedFetch(`${API_BASE}/stocks/bullish-summary/`, token, { signal });
  if (!response.ok) throw new Error('Bullish summary unavailable');
  const payload = await response.json() as BullishSummary;
  if (!Array.isArray(payload.stocks) || !Number.isInteger(payload.count)) throw new Error('Invalid bullish summary');
  return payload;
}
export type StreamEvent =
  | { type: 'report'; sections: QuickReport | DetailedReport }
  | { type: "context"; data: AnalysisContext }
  | { type: "meta"; model: string; mode: AnalysisMode }
  | { type: "token"; content: string }
  | { type: "error"; message: string }
  | { type: "done" };

function expireSession() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

async function authorizedFetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const request = (access: string) => fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${access}` },
  });
  const storedAccess = localStorage.getItem(ACCESS_KEY) || token;
  let response = await request(storedAccess);
  if (response.status !== 401) return response;

  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) {
    expireSession();
    return response;
  }
  const refreshResponse = await fetch(`${API_BASE}/auth/token/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!refreshResponse.ok) {
    expireSession();
    return response;
  }
  const refreshed = await refreshResponse.json() as { access: string };
  localStorage.setItem(ACCESS_KEY, refreshed.access);
  response = await request(refreshed.access);
  if (response.status === 401) expireSession();
  return response;
}

export async function login(username: string, password: string): Promise<AuthTokens> {
  const response = await fetch(`${API_BASE}/auth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error("帳號或密碼不正確");
  return response.json();
}

export async function loginWithGoogle(credential: string): Promise<AuthTokens> {
  const response = await fetch(`${API_BASE}/auth/google/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(payload.detail || `Google sign-in responded ${response.status}`);
  }
  return response.json();
}

export async function fetchGoogleAuthConfig(): Promise<{ enabled: boolean; client_id: string }> {
  const response = await fetch(`${API_BASE}/auth/google/config/`);
  if (!response.ok) throw new Error(`Google auth config responded ${response.status}`);
  return response.json();
}

export async function fetchStocks(token: string): Promise<StockApiResponse[]> {
  const response = await authorizedFetch(`${API_BASE}/stocks/`, token);
  if (!response.ok) throw new Error(`股票 API 回應 ${response.status}`);
  return response.json();
}

export async function alertRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await authorizedFetch(`${API_BASE}/${path}`, localStorage.getItem(ACCESS_KEY) || '', {
    ...init, headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Alert API responded ${response.status}`);
  return payload as T;
}

export async function searchYahooStocks(token: string, query: string, signal?: AbortSignal, market: 'US' | 'TW' = 'US'): Promise<YahooStockResult[]> {
  const params = new URLSearchParams({ q: query, market });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = window.setTimeout(cancel, 18000);
  try {
    const response = await authorizedFetch(`${API_BASE}/stocks/search/?${params}`, token, { signal: controller.signal });
    if (!response.ok) throw new Error(`Yahoo Finance search responded ${response.status}`);
    const payload = await response.json() as { results: YahooStockResult[] };
    return payload.results;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('Search timed out');
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function addYahooStock(token: string, symbol: string, market: 'US' | 'TW' = 'US'): Promise<StockApiResponse> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await authorizedFetch(`${API_BASE}/watchlist/yahoo/`, token, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, market }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { detail?: string };
      throw new Error(payload.detail || `Watchlist API responded ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error('加入股票逾時，請重新整理清單確認是否已加入，再重試。 / Request timed out; refresh your list before retrying.');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function removeTrackedStock(token: string, stockId: number): Promise<void> {
  const response = await authorizedFetch(`${API_BASE}/watchlist/stocks/${stockId}/`, token, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`Watchlist API responded ${response.status}`);
}

export async function fetchStockChart(token: string, stockId: number, range: ChartRange, signal?: AbortSignal, technical = false): Promise<YahooChartResponse> {
  const params = new URLSearchParams({ range });
  if (technical) params.set('technical', 'true');
  const response = await authorizedFetch(`${API_BASE}/stocks/${stockId}/chart/?${params}`, token, { signal });
  if (!response.ok) throw new Error(`Yahoo Finance chart responded ${response.status}`);
  return response.json();
}

export async function streamAnalysis(options: {
  token: string;
  stockId: number;
  question: string;
  mode: AnalysisMode;
  comparisons?: AnalysisPeer[];
  language?: 'zh' | 'en';
  signal?: AbortSignal;
  onEvent: (event: StreamEvent) => void;
}): Promise<void> {
  const response = await authorizedFetch(`${API_BASE}/ai/analyze/`, options.token, {
    method: "POST",
    signal: options.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stock_id: options.stockId, question: options.question, mode: options.mode, comparisons: options.comparisons ?? [], language: options.language }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `AI API 回應 ${response.status}`);
  }
  if (!response.body) throw new Error("瀏覽器不支援串流回應");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const packets = buffer.split("\n\n");
    buffer = packets.pop() || "";
    for (const packet of packets) {
      const line = packet.split("\n").find((item) => item.startsWith("data: "));
      if (line) options.onEvent(JSON.parse(line.slice(6)) as StreamEvent);
    }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
