from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx
import pandas as pd
import re
from urllib.parse import quote as urlquote
from django.core.cache import cache
from .native_names import native_stock_name

YAHOO_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
US_EQUITY_EXCHANGES = {
    "NMS", "NGM", "NCM",  # Nasdaq markets
    "NYQ", "ASE",           # NYSE and NYSE American
    "BTS", "PCX",           # Cboe and NYSE Arca
    "PNK", "OQB", "OQX", "OTC",  # US OTC markets
}
NON_COMMON_EQUITY_TERMS = (" etf", " etn", " fund", " warrant", " unit", " rights")
GOLD_FUTURE_SYMBOLS = {"GC=F", "MGC=F"}
BITCOIN_SYMBOLS = {"BTC-USD"}
CHART_RANGES = {
    "1D": {"range": "1d", "interval": "5m"},
    "1W": {"range": "5d", "interval": "15m"},
    "1M": {"range": "1mo", "interval": "1d"},
    "6M": {"range": "6mo", "interval": "1d"},
    "YTD": {"range": "ytd", "interval": "1d"},
    "1Y": {"range": "1y", "interval": "1d"},
    "5Y": {"range": "5y", "interval": "1wk"},
    "ALL": {"range": "max", "interval": "1mo"},
}


class YahooFinanceError(RuntimeError):
    pass


def _market_state(meta: dict) -> str:
    if str(meta.get("instrumentType", "")).upper() == "CRYPTOCURRENCY":
        return "OPEN_24H"

    now = int(datetime.now(timezone.utc).timestamp())
    periods = meta.get("currentTradingPeriod", {})
    for key, state in (("pre", "PRE"), ("regular", "REGULAR"), ("post", "POST")):
        period = periods.get(key) or {}
        if period.get("start", 0) <= now < period.get("end", 0):
            return state
    return "CLOSED"


def get_market_asset(symbol: str, market: str = 'US') -> dict | None:
    normalized = symbol.strip().upper()
    if not normalized:
        return None
    return next(
        (asset for asset in search_market_assets(normalized, limit=20, market=market) if asset["symbol"] == normalized),
        None,
    )


def daily_indicator_points(points: list[dict]) -> list[dict]:
    frame = pd.DataFrame(points).sort_values('timestamp').drop_duplicates('timestamp').reset_index(drop=True)
    close = frame['price']
    for days in (60, 100, 200, 250):
        frame[f'ma{days}'] = close.rolling(days, min_periods=days).mean()
    macd = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
    signal = macd.ewm(span=9, adjust=False).mean()
    frame['macd'] = macd.where(frame.index >= 33)
    frame['macd_signal'] = signal.where(frame.index >= 33)
    frame['histogram'] = (macd - signal).where(frame.index >= 33)
    return frame.astype(object).where(pd.notna(frame), None).to_dict('records')


def get_price_chart(symbol: str, market: str, range_key: str, technical: bool = False) -> dict:
    normalized_range = range_key.upper()
    if normalized_range not in {*CHART_RANGES, "3Y"}:
        raise ValueError("Unsupported chart range")

    yahoo_symbol = f"{symbol}.TW" if market.upper() == "TW" and not symbol.upper().endswith(('.TW', '.TWO')) else symbol
    if technical and normalized_range not in {'1M', '6M', 'YTD', '1Y', '3Y', '5Y', 'ALL'}:
        raise ValueError('Technical charts require a daily range')
    cache_key = f"yahoo-price-chart:v3:{yahoo_symbol}:{normalized_range}:{technical}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    params = {
        "includePrePost": "true" if normalized_range == "1D" else "false",
        "events": "div,splits",
    }
    cutoff = None
    if technical:
        now = pd.Timestamp.now(tz='UTC')
        offsets = {'1M': pd.DateOffset(months=1), '6M': pd.DateOffset(months=6),
                   '1Y': pd.DateOffset(years=1), '3Y': pd.DateOffset(years=3),
                   '5Y': pd.DateOffset(years=5)}
        cutoff = now.normalize().replace(month=1, day=1) if normalized_range == 'YTD' else (
            now.normalize() - offsets[normalized_range] if normalized_range != 'ALL' else None
        )
        params.update({'interval': '1d', 'includePrePost': 'false'})
        if cutoff is None:
            params['range'] = 'max'
        else:
            # Warm up daily averages and EMAs before cropping the visible range.
            params.update({'period1': int((cutoff - pd.Timedelta(days=730)).timestamp()),
                           'period2': int(now.timestamp())})
    elif normalized_range == "3Y":
        now = datetime.now(timezone.utc)
        params.update({
            "period1": int((now - timedelta(days=365 * 3)).timestamp()),
            "period2": int(now.timestamp()),
            "interval": "1wk",
        })
    else:
        params.update(CHART_RANGES[normalized_range])

    try:
        response = httpx.get(
            YAHOO_CHART_URL.format(symbol=yahoo_symbol),
            params=params,
            headers={"User-Agent": "Mozilla/5.0 PickingGeek/1.0"},
            timeout=10.0,
        )
        response.raise_for_status()
        chart = response.json().get("chart", {})
        if chart.get("error") or not chart.get("result"):
            raise YahooFinanceError("Yahoo Finance returned no chart data")
        result = chart["result"][0]
        meta = result.get("meta", {})
        timestamps = result.get("timestamp", [])
        closes = result.get("indicators", {}).get("quote", [{}])[0].get("close", [])
    except (httpx.HTTPError, ValueError, TypeError, KeyError, IndexError) as exc:
        raise YahooFinanceError("Yahoo Finance chart is temporarily unavailable") from exc

    points = [
        {"timestamp": timestamp, "price": round(float(close), 4)}
        for timestamp, close in zip(timestamps, closes)
        if close is not None
    ]
    if not points:
        raise YahooFinanceError("Yahoo Finance returned no price points")

    if technical:
        points = daily_indicator_points(points)
        if cutoff is not None:
            points = [point for point in points if point['timestamp'] >= cutoff.timestamp()]
        if not points:
            raise YahooFinanceError('No daily prices in the selected range')

    payload = {
        "symbol": symbol,
        "range": normalized_range,
        "currency": meta.get("currency", "USD"),
        "timezone": meta.get("exchangeTimezoneName", "America/New_York"),
        "previous_close": points[0]['price'] if technical else meta.get("chartPreviousClose") or meta.get("previousClose"),
        "current_price": meta.get("fulldayPrice") or points[-1]["price"],
        "market_state": _market_state(meta),
        "updated_at": points[-1]["timestamp"],
        "points": points,
    }
    cache.set(cache_key, payload, timeout=2 if normalized_range == "1D" else 60 if normalized_range == "1W" else 900)
    return payload


def enrich_market_assets(assets: list[dict]) -> list[dict]:
    def fetch_snapshot(asset: dict) -> tuple[str, dict]:
        name = native_stock_name(asset['symbol'], asset.get('market', 'US'), asset['name'])
        try:
            chart = get_price_chart(asset["symbol"], asset.get('market', 'US'), "1D")
            previous = chart.get("previous_close")
            price = chart.get("current_price")
            change_percent = ((price - previous) / previous) * 100 if price is not None and previous else None
            return asset["symbol"], {
                'name': name,
                "price": price,
                "change_percent": round(change_percent, 4) if change_percent is not None else None,
                "currency": chart.get("currency", "USD"),
                "market_state": "OPEN_24H" if asset["asset_type"] == "BITCOIN" else chart.get("market_state", "CLOSED"),
                "updated_at": chart.get("updated_at"),
            }
        except YahooFinanceError:
            return asset["symbol"], {
                'name': name,
                "price": None, "change_percent": None, "currency": asset.get('currency', 'USD'),
                "market_state": "UNAVAILABLE", "updated_at": None,
            }

    snapshots = {}
    with ThreadPoolExecutor(max_workers=min(6, max(1, len(assets)))) as executor:
        futures = [executor.submit(fetch_snapshot, asset) for asset in assets]
        for future in as_completed(futures):
            symbol, snapshot = future.result()
            snapshots[symbol] = snapshot
    return [{**asset, **snapshots.get(asset["symbol"], {})} for asset in assets]


def search_taiwan_names(query: str, limit: int) -> list[dict]:
    try:
        response = httpx.get(
            'https://tw.stock.yahoo.com/_td-stock/api/resource/AutocompleteService;query='
            + urlquote(query, safe=''),
            headers={'User-Agent': 'Mozilla/5.0 PickingGeek/1.0'},
            timeout=8.0,
        )
        response.raise_for_status()
        candidates = response.json()['ResultSet']['Result']
        if not isinstance(candidates, list):
            raise ValueError('Invalid autocomplete response')
    except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
        raise YahooFinanceError('Taiwan name search is temporarily unavailable') from exc

    # Restrict autocomplete to ordinary stock / ETF symbols, excluding warrants.
    names = {}
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        symbol = str(candidate.get('symbol', '')).upper()
        if re.fullmatch(r'(?:\d{4,5}|00\d{3}[A-Z])\.(?:TW|TWO)', symbol):
            names.setdefault(symbol, str(candidate.get('name') or symbol))
    if not names:
        return []

    def resolve(item):
        symbol, name = item
        matches = search_market_assets(symbol, limit=20, market='TW')
        asset = next((asset for asset in matches if asset['symbol'] == symbol), None)
        if asset:
            asset = {**asset, 'name': name}
            cache.set(f'taiwan-native-name:v1:{symbol}', name, timeout=86400)
        return asset

    results = []
    with ThreadPoolExecutor(max_workers=min(6, len(names))) as executor:
        for asset in executor.map(resolve, list(names.items())[:limit]):
            if asset:
                results.append(asset)
    return results


def search_market_assets(query: str, limit: int = 12, market: str = 'US') -> list[dict]:
    market = market.upper()
    if market not in {'US', 'TW'}:
        raise ValueError('Unsupported market')
    normalized = query.strip()
    if not normalized:
        return []

    cache_key = f"yahoo-market-search:v6:{market}:{normalized.casefold()}:{limit}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    if market == 'TW' and any('\u3400' <= char <= '\u9fff' for char in normalized):
        results = search_taiwan_names(normalized, limit)
        cache.set(cache_key, results, timeout=300)
        return results

    try:
        response = httpx.get(
            YAHOO_SEARCH_URL,
            params={
                "q": normalized,
                "quotesCount": min(max(limit * 3, 20), 50),
                "newsCount": 0,
                "region": 'TW' if market == 'TW' else 'US',
                "lang": 'zh-TW' if market == 'TW' else 'en-US',
            },
            headers={"User-Agent": "Mozilla/5.0 PickingGeek/1.0"},
            timeout=8.0,
        )
        response.raise_for_status()
        quotes = response.json().get("quotes", [])
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise YahooFinanceError("Yahoo Finance search is temporarily unavailable") from exc

    results = []
    seen = set()
    for quote in quotes:
        symbol = str(quote.get("symbol", "")).strip().upper()
        exchange = str(quote.get("exchange", "")).upper()
        quote_type = str(quote.get("quoteType", "")).upper()
        name = str(quote.get("longname") or quote.get("shortname") or symbol).strip()
        normalized_name = f" {name.casefold()}"
        asset_type = None
        if market == 'TW':
            if symbol.endswith(('.TW', '.TWO')) and quote_type in {'EQUITY', 'ETF'}:
                asset_type = 'ETF' if quote_type == 'ETF' else 'STOCK'
        elif quote_type == "EQUITY" and exchange in US_EQUITY_EXCHANGES:
            if not any(term in normalized_name for term in NON_COMMON_EQUITY_TERMS):
                asset_type = "STOCK"
        elif quote_type == "ETF" and exchange in US_EQUITY_EXCHANGES:
            asset_type = "ETF"
        elif quote_type == "FUTURE" and symbol in GOLD_FUTURE_SYMBOLS:
            asset_type = "GOLD"
        elif quote_type == "CRYPTOCURRENCY" and symbol in BITCOIN_SYMBOLS:
            asset_type = "BITCOIN"
        if not asset_type or not symbol or symbol in seen:
            continue
        seen.add(symbol)
        results.append({
            "symbol": symbol,
            "market": market,
            "currency": 'TWD' if market == 'TW' else 'USD',
            "name": name,
            "exchange": exchange,
            "exchange_name": quote.get("exchDisp") or exchange,
            "sector": quote.get("sectorDisp") or quote.get("sector") or "",
            "asset_type": asset_type,
            "yahoo_url": f"https://tw.stock.yahoo.com/quote/{symbol}" if market == 'TW' else f"https://finance.yahoo.com/quote/{symbol}",
        })
        if len(results) >= limit:
            break

    cache.set(cache_key, results, timeout=300)
    return results
