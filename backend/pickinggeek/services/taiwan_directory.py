"""Official listed / OTC security identities, independent of Yahoo search ranking."""

import re
import unicodedata
from html.parser import HTMLParser

import httpx
from django.core.cache import cache


class SecurityTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = []
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        elif tag in {'td', 'th'}:
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in {'td', 'th'} and self.cell is not None:
            self.row.append(' '.join(''.join(self.cell).split()))
            self.cell = None
        elif tag == 'tr' and self.row:
            self.rows.append(self.row)


def parse_directory(html, suffix):
    parser = SecurityTableParser()
    parser.feed(html)
    assets = {}
    category = ''
    for row in parser.rows:
        if len(row) == 1:
            category = row[0].upper()
            continue
        if len(row) < 6:
            continue
        identity = row[0].split(maxsplit=1)
        if len(identity) != 2 or not re.fullmatch(r'\d{4,6}[A-Z]?', identity[0]):
            continue
        code, name = identity
        cfi = row[5].upper()
        is_etf = 'ETF' in category
        if not (is_etf or cfi.startswith('E')):
            continue
        symbol = f'{code}.{suffix}'
        assets[symbol] = {
            'symbol': symbol, 'name': name, 'market': 'TW', 'currency': 'TWD',
            'exchange': 'TAI' if suffix == 'TW' else 'TWO',
            'exchange_name': '\u4e0a\u5e02' if suffix == 'TW' else '\u4e0a\u6ac3',
            'sector': row[4], 'asset_type': 'ETF' if is_etf else 'STOCK',
            'yahoo_url': f'https://tw.stock.yahoo.com/quote/{symbol}',
        }
    if not assets:
        raise ValueError('Official security directory was empty or changed format')
    return list(assets.values())


def get_taiwan_directory():
    """Keep available exchanges searchable even when the other source is down."""
    assets = []
    for mode, suffix in ((2, 'TW'), (4, 'TWO')):
        key = f'taiwan-securities:v1:{suffix}'
        rows = cache.get(key)
        if rows is None and not cache.get(f'{key}:retry'):
            try:
                response = httpx.get(
                    'https://isin.twse.com.tw/isin/C_public.jsp', params={'strMode': mode},
                    headers={'User-Agent': 'Mozilla/5.0 PickingGeek/1.0'}, timeout=3.0,
                )
                response.raise_for_status()
                rows = parse_directory(response.content.decode('cp950', errors='replace'), suffix)
                cache.set(key, rows, 86400)
                cache.set(f'{key}:stale', rows, 7 * 86400)
            except (httpx.HTTPError, ValueError):
                cache.set(f'{key}:retry', True, 60)
        rows = rows or cache.get(f'{key}:stale')
        assets.extend(rows or [])
    return assets or None


def search_directory(query, limit):
    assets = get_taiwan_directory()
    if assets is None:
        return None
    def normalized(value):
        return unicodedata.normalize('NFKC', value).strip().upper().replace('\u81fa', '\u53f0')

    query = normalized(query)
    matches = [asset for asset in assets if query in asset['symbol'].split('.')[0]
               or query in normalized(asset['name']) or query == asset['symbol']]
    matches.sort(key=lambda asset: (
        asset['symbol'] != query and asset['symbol'].split('.')[0] != query,
        not (asset['symbol'].startswith(query) or normalized(asset['name']).startswith(query)), asset['symbol'],
    ))
    return matches[:limit]
