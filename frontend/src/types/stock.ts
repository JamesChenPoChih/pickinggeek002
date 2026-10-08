export type DetailTone = "positive" | "negative" | "neutral";

export interface DetailLeaf {
  id: string;
  label: string;
  value: string;
  tone?: DetailTone;
}

export interface DetailGroup {
  id: string;
  label: string;
  children: DetailNode[];
}

export type DetailNode = DetailLeaf | DetailGroup;

export interface ChartPoint {
  date: string;
  price: number;
  ma60: number;
  ma200: number;
}

export interface StockIndicator {
  as_of_date: string;
  close_price: string;
  macd: string | null;
  macd_signal: string | null;
  macd_histogram: string | null;
  macd_status: "BULLISH" | "BEARISH" | "NEUTRAL";
  ma60: string | null;
  ma100: string | null;
  ma200: string | null;
  above_ma60: boolean | null;
  above_ma100: boolean | null;
  above_ma200: boolean | null;
  summary: string;
  chart_points: ChartPoint[];
}

export interface StockPosition {
  id: number;
  symbol: string;
  market: "US" | "TW";
  name: string;
  currency: string;
  currentPrice: number;
  changePercent: number;
  chartData: ChartPoint[];
  indicator: StockIndicator | null;
  nestedDetails: DetailNode[];
}

export interface StockAppSchema {
  user: {
    name: string;
    handle: string;
    avatarUrl?: string;
    tier: "FREE" | "PRO";
  };
  portfolio: {
    title: string;
    selectedStockId: number;
    stocks: StockPosition[];
  };
}

export interface StockApiResponse {
  id: number;
  symbol: string;
  market: "US" | "TW";
  name: string;
  currency: string;
  indicator: StockIndicator | null;
}

export interface YahooStockResult {
  market: 'US' | 'TW';
  symbol: string;
  name: string;
  exchange: string;
  exchange_name: string;
  sector: string;
  asset_type: "STOCK" | "ETF" | "GOLD" | "BITCOIN";
  yahoo_url: string;
  price: number | null;
  change_percent: number | null;
  currency: string;
  market_state: "PRE" | "REGULAR" | "POST" | "CLOSED" | "OPEN_24H" | "UNAVAILABLE";
  updated_at: number | null;
}

export type ChartRange = "1D" | "1W" | "1M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "ALL";

export interface YahooChartResponse {
  symbol: string;
  range: ChartRange;
  currency: string;
  timezone: string;
  previous_close: number | null;
  current_price: number;
  points: Array<{
    timestamp: number; price: number;
    ma60?: number | null; ma100?: number | null;
    ma200?: number | null; ma250?: number | null;
    macd?: number | null; macd_signal?: number | null; histogram?: number | null;
  }>;
}
