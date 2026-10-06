from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx
from django.core.cache import cache

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


def get_market_asset(symbol: str) -> dict | None:
    normalized = symbol.strip().upper()
    if not normalized:
        return None
    return next(
        (asset for asset in search_market_assets(normalized, limit=20) if asset["symbol"] == normalized),
        None,
    )


def get_price_chart(symbol: str, market: str, range_key: str) -> dict:
    normalized_range = range_key.upper()
    if normalized_range not in {*CHART_RANGES, "3Y"}:
        raise ValueError("Unsupported chart range")

    yahoo_symbol = f"{symbol}.TW" if market.upper() == "TW" else symbol
    cache_key = f"yahoo-price-chart:v2:{yahoo_symbol}:{normalized_range}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    params = {
        "includePrePost": "true" if normalized_range == "1D" else "false",
        "events": "div,splits",
    }
    if normalized_range == "3Y":
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

    payload = {
        "symbol": symbol,
        "range": normalized_range,
        "currency": meta.get("currency", "USD"),
        "timezone": meta.get("exchangeTimezoneName", "America/New_York"),
        "previous_close": meta.get("chartPreviousClose") or meta.get("previousClose"),
        "current_price": meta.get("fulldayPrice") or points[-1]["price"],
        "market_state": _market_state(meta),
        "updated_at": points[-1]["timestamp"],
        "points": points,
    }
    cache.set(cache_key, payload, timeout=2 if normalized_range == "1D" else 60 if normalized_range == "1W" else 900)
    return payload


def enrich_market_assets(assets: list[dict]) -> list[dict]:
    def fetch_snapshot(asset: dict) -> tuple[str, dict]:
        try:
            chart = get_price_chart(asset["symbol"], "US", "1D")
            previous = chart.get("previous_close")
            price = chart.get("current_price")
            change_percent = ((price - previous) / previous) * 100 if price is not None and previous else None
            return asset["symbol"], {
                "price": price,
                "change_percent": round(change_percent, 4) if change_percent is not None else None,
                "currency": chart.get("currency", "USD"),
                "market_state": "OPEN_24H" if asset["asset_type"] == "BITCOIN" else chart.get("market_state", "CLOSED"),
                "updated_at": chart.get("updated_at"),
            }
        except YahooFinanceError:
            return asset["symbol"], {
                "price": None, "change_percent": None, "currency": "USD",
                "market_state": "UNAVAILABLE", "updated_at": None,
            }

    snapshots = {}
    with ThreadPoolExecutor(max_workers=min(6, max(1, len(assets)))) as executor:
        futures = [executor.submit(fetch_snapshot, asset) for asset in assets]
        for future in as_completed(futures):
            symbol, snapshot = future.result()
            snapshots[symbol] = snapshot
    return [{**asset, **snapshots.get(asset["symbol"], {})} for asset in assets]


def search_market_assets(query: str, limit: int = 12) -> list[dict]:
    normalized = query.strip()
    if not normalized:
        return []

    cache_key = f"yahoo-market-search:v4:{normalized.casefold()}:{limit}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        response = httpx.get(
            YAHOO_SEARCH_URL,
            params={
                "q": normalized,
                "quotesCount": min(max(limit * 3, 20), 50),
                "newsCount": 0,
                "region": "US",
                "lang": "en-US",
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
        if quote_type == "EQUITY" and exchange in US_EQUITY_EXCHANGES:
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
            "name": name,
            "exchange": exchange,
            "exchange_name": quote.get("exchDisp") or exchange,
            "sector": quote.get("sectorDisp") or quote.get("sector") or "",
            "asset_type": asset_type,
            "yahoo_url": f"https://finance.yahoo.com/quote/{symbol}",
        })
        if len(results) >= limit:
            break

    cache.set(cache_key, results, timeout=300)
    return results
