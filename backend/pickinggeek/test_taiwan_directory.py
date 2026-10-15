from unittest.mock import Mock, patch

import httpx
from django.core.cache import cache
from django.test import SimpleTestCase

from .services.taiwan_directory import get_taiwan_directory, parse_directory, search_directory
from .services.yahoo_finance import get_market_asset, search_market_assets


HTML = '''<table><tr><td>股票</td></tr>
<tr><td>2330　台積電</td><td>TW0002330008</td><td>1994/09/05</td><td>上市</td><td>半導體</td><td>ESVUFR</td></tr>
<tr><td>6488　環球晶</td><td>TW0006488000</td><td>2011/01/01</td><td>上櫃</td><td>半導體</td><td>ESVUFR</td></tr>
<tr><td>2881A　富邦特</td><td>TW0002881A00</td><td>2010/01/01</td><td>上市</td><td>金融</td><td>EPVUFR</td></tr>
<tr><td>ETF</td></tr>
<tr><td>0050　元大台灣50</td><td>TW0000050004</td><td>2003/01/01</td><td>上市</td><td></td><td>CEOGEU</td></tr>
<tr><td>00980A　主動基金</td><td>TW0000098000</td><td>2025/01/01</td><td>上市</td><td></td><td>CEOGEU</td></tr>
<tr><td>00679B　債券ETF</td><td>TW0000067900</td><td>2020/01/01</td><td>上櫃</td><td></td><td>CEOGEU</td></tr>
<tr><td>認購權證</td></tr>
<tr><td>056552　權證</td><td>TW0000565500</td><td>2020/01/01</td><td>上市</td><td></td><td>RWXXXX</td></tr></table>'''


class TaiwanDirectoryTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_parse_stock_preferred_and_all_etf_code_shapes(self):
        assets = parse_directory(HTML, 'TW')
        self.assertEqual([item['symbol'] for item in assets],
                         ['2330.TW', '6488.TW', '2881A.TW', '0050.TW', '00980A.TW', '00679B.TW'])
        self.assertEqual(assets[0]['name'], '台積電')
        self.assertTrue(all(item['asset_type'] == 'ETF' for item in assets[3:]))
        self.assertEqual(parse_directory(HTML, 'TWO')[0]['exchange'], 'TWO')

    def test_invalid_directory_is_not_silently_empty(self):
        with self.assertRaises(ValueError):
            parse_directory('<html>Maintenance</html>', 'TW')

    @patch('pickinggeek.services.taiwan_directory.get_taiwan_directory')
    def test_single_character_and_full_chinese_names(self, directory):
        directory.return_value = [
            {'symbol': '2454.TW', 'name': '聯發科'},
            {'symbol': '2303.TW', 'name': '聯電'},
            {'symbol': '3231.TW', 'name': '緯創'},
            {'symbol': '2330.TW', 'name': '臺積電'},
        ]
        self.assertIn('2454.TW', [item['symbol'] for item in search_directory('聯', 12)])
        self.assertEqual(search_directory('緯創', 12)[0]['symbol'], '3231.TW')
        self.assertEqual(search_directory('台積', 12)[0]['symbol'], '2330.TW')

    @patch('pickinggeek.services.taiwan_directory.httpx.get')
    def test_otc_failure_does_not_discard_listed_search_results(self, get):
        get.side_effect = [Mock(content=HTML.encode('cp950')), httpx.ReadTimeout('OTC unavailable')]
        assets = get_taiwan_directory()
        self.assertTrue(assets)
        self.assertTrue(all(asset['symbol'].endswith('.TW') for asset in assets))

    @patch('pickinggeek.services.taiwan_directory.get_taiwan_directory')
    def test_code_chinese_prefix_exact_ranking_and_leading_zeroes(self, directory):
        directory.return_value = parse_directory(HTML, 'TW')
        self.assertEqual(search_directory('0050', 12)[0]['symbol'], '0050.TW')
        self.assertEqual(search_directory('台積', 12)[0]['symbol'], '2330.TW')
        self.assertEqual(len(search_directory('00', 2)), 2)
        self.assertEqual(search_directory('6488.TW', 12)[0]['symbol'], '6488.TW')
        self.assertEqual(search_directory('不存在', 12), [])

    @patch('pickinggeek.services.taiwan_directory.httpx.get')
    def test_both_exchanges_cached_and_stale_used_on_failure(self, get):
        get.return_value = Mock(content=HTML.encode('cp950'))
        assets = get_taiwan_directory()
        self.assertEqual(len(assets), 12)
        self.assertEqual(get.call_count, 2)
        self.assertEqual(get_taiwan_directory(), assets)
        self.assertEqual(get.call_count, 2)
        for suffix in ('TW', 'TWO'):
            cache.delete(f'taiwan-securities:v1:{suffix}')
        get.side_effect = httpx.ConnectError('offline')
        self.assertEqual(get_taiwan_directory(), assets)
        calls = get.call_count
        self.assertEqual(get_taiwan_directory(), assets)
        self.assertEqual(get.call_count, calls)

    @patch('pickinggeek.services.yahoo_finance.httpx.get')
    @patch('pickinggeek.services.yahoo_finance.search_directory')
    def test_search_and_add_identity_do_not_depend_on_yahoo_listing(self, directory, yahoo):
        asset = {**parse_directory(HTML, 'TWO')[-1], 'symbol': '00679B.TWO'}
        directory.return_value = [asset]
        cache.set('taiwan-securities:v1:TWO', [asset], 60)
        self.assertEqual(search_market_assets('00679B', market='TW'), [asset])
        self.assertEqual(get_market_asset('00679B', market='TW'), asset)
        self.assertEqual(get_market_asset('00679B.TWO', market='TW'), asset)
        yahoo.assert_not_called()

    @patch('pickinggeek.services.yahoo_finance.httpx.get')
    def test_exact_tickers_use_chart_metadata_not_search_or_directory_refresh(self, get):
        for code, kind in [('0050', 'ETF'), ('2317', 'EQUITY')]:
            get.return_value = Mock(status_code=200)
            get.return_value.json.return_value = {'chart': {'result': [{'meta': {
                'symbol': f'{code}.TW', 'instrumentType': kind, 'currency': 'TWD', 'shortName': code,
            }}]}}
            self.assertEqual(get_market_asset(code, 'TW')['symbol'], f'{code}.TW')
            self.assertIn(f'/chart/{code}.TW', get.call_args.args[0])
            self.assertEqual(get.call_args.kwargs['timeout'], 5.0)

    @patch('pickinggeek.services.yahoo_finance.httpx.get')
    def test_bad_identity_is_rejected_and_network_failure_is_not_not_found(self, get):
        get.return_value = Mock(status_code=200)
        get.return_value.json.return_value = {'chart': {'result': [{'meta': {
            'symbol': 'OTHER', 'instrumentType': 'ETF', 'currency': 'TWD',
        }}]}}
        self.assertIsNone(get_market_asset('0050.TW', 'TW'))
        get.side_effect = httpx.ReadTimeout('timeout')
        from .services.yahoo_finance import YahooFinanceError
        with self.assertRaises(YahooFinanceError):
            get_market_asset('0050.TW', 'TW')
