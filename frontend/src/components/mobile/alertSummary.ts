import { ruleName } from './AlertDialog';

export interface AlertRule { kind: string; [key: string]: string | number }
export interface AlertPayload {
  type?: string; symbol?: string; name?: string; market_date?: string; currency?: string;
  price?: number; rules?: AlertRule[]; snapshot?: Record<string, number | null>;
}
const value = (number: number | undefined | null) => number == null || !Number.isFinite(number) ? '—' : number.toLocaleString(undefined, { maximumFractionDigits: 4 });

export function ruleSummary(rule: AlertRule, zh: boolean, payload: AlertPayload) {
  const up = rule.direction !== 'DOWN';
  const snapshot = payload.snapshot ?? {};
  const cross = zh ? (up ? '向上突破' : '向下跌破') : (up ? 'crossed above' : 'crossed below');
  switch (rule.kind) {
    case 'ma_price_cross': return `${zh ? '股價' : 'Price'} ${cross} MA ${rule.period} · ${value(payload.price)} / ${value(snapshot[`ma${rule.period}`])}`;
    case 'ma_cross': return `MA ${rule.short} ${cross} MA ${rule.long}`;
    case 'ma_alignment': return zh ? `${up ? '多頭' : '空頭'}排列：MA 5 / 20 / 60 / 200` : `${up ? 'Bullish' : 'Bearish'} MA alignment: 5 / 20 / 60 / 200`;
    case 'ma_bias': return `MA ${rule.period} · ${zh ? '乖離率越過門檻' : 'Bias crossed threshold'} ${rule.threshold}%`;
    case 'macd_cross': return `MACD ${zh ? (up ? '黃金交叉' : '死亡交叉') : (up ? 'bullish crossover' : 'bearish crossover')} · DIF ${value(snapshot.macd)} / DEA ${value(snapshot.macd_signal)}`;
    case 'macd_zero': return `DIF ${cross} 0 · ${value(snapshot.macd)}`;
    case 'macd_trend': return zh ? `MACD 柱狀體連續 ${rule.days} 日${up ? '遞增' : '遞減'}` : `MACD histogram ${up ? 'increased' : 'decreased'} for ${rule.days} sessions`;
    case 'bb_boundary': return `Bollinger Bands · ${zh ? (up ? '突破上軌' : '跌破下軌') : (up ? 'crossed upper band' : 'crossed lower band')} · ${value(payload.price)} / ${value(up ? snapshot.bb_upper : snapshot.bb_lower)}`;
    case 'bb_middle': return `Bollinger Bands · ${zh ? '回測並守住中軌' : 'retested and held middle band'} ${value(snapshot.bb_middle)}`;
    case 'bb_width': return `Bollinger Bands · ${zh ? '頻寬跌破' : 'bandwidth fell below'} ${rule.threshold}%${snapshot.bb_bandwidth == null ? '' : ` (${value(snapshot.bb_bandwidth * 100)}%)`}`;
    case 'bb_expansion': return `Bollinger Bands · ${zh ? '帶量突破，頻寬增幅至少' : 'volume breakout; bandwidth growth at least'} ${rule.growth}% · ${zh ? '量比' : 'volume ratio'} ${rule.volume_ratio}×`;
    case 'squeeze_on': return `Squeeze ON · ${zh ? '進入壓縮' : 'compression started'}`;
    case 'squeeze_release': return `Squeeze OFF · ${zh ? '擠壓解除' : 'compression released'}`;
    case 'squeeze_momentum': return `Squeeze · ${zh ? (up ? '多頭動能轉強' : '空頭動能轉強') : (up ? 'bullish momentum strengthened' : 'bearish momentum strengthened')} · ${value(snapshot.squeeze_momentum)}`;
    default: return ruleName(rule.kind, zh);
  }
}

export const alertSummary = (payload: AlertPayload, zh: boolean) => payload.rules?.map(rule => ruleSummary(rule, zh, payload)).join(' & ') ?? '';
