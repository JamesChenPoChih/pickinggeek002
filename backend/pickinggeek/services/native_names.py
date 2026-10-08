from html.parser import HTMLParser
from urllib.parse import quote

import httpx
from django.core.cache import cache


class QuoteTitleParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ''

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'meta' and attributes.get('property') == 'og:title':
            self.title = attributes.get('content', '')


def native_stock_name(symbol, market, fallback):
    if market != 'TW' or any('\u3400' <= char <= '\u9fff' for char in fallback):
        return fallback
    yahoo_symbol = symbol if symbol.endswith(('.TW', '.TWO')) else f'{symbol}.TW'
    key = f'taiwan-native-name:v1:{yahoo_symbol}'
    cached = cache.get(key)
    if cached is not None:
        return cached or fallback
    name = ''
    try:
        response = httpx.get(
            f'https://tw.stock.yahoo.com/quote/{quote(yahoo_symbol, safe=".")}',
            headers={'User-Agent': 'Mozilla/5.0 PickingGeek/1.0'}, timeout=5,
            follow_redirects=True,
        )
        response.raise_for_status()
        parser = QuoteTitleParser()
        parser.feed(response.text)
        # Accept only metadata identifying the exact requested instrument.
        candidate, separator, _ = parser.title.partition(f'({yahoo_symbol})')
        if separator and any('\u3400' <= char <= '\u9fff' for char in candidate):
            name = candidate.strip()
    except (httpx.HTTPError, ValueError):
        pass
    cache.set(key, name, timeout=86400 if name else 300)
    return name or fallback
