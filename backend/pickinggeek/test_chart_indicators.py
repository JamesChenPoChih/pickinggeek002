import json
import math
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import SimpleTestCase

from .services.yahoo_finance import daily_indicator_points, get_price_chart


def candles(closes, spread=1):
    return [{'timestamp': i * 86400, 'price': float(close), 'close': float(close),
             'open': float(close), 'high': float(close + spread), 'low': float(close - spread)}
            for i, close in enumerate(closes)]


class ChartIndicatorTests(SimpleTestCase):
    def test_bollinger_population_deviation_and_warmup(self):
        points = daily_indicator_points(candles(range(1, 61)))
        self.assertIsNone(points[18]['bb_upper'])
        self.assertAlmostEqual(points[19]['bb_middle'], 10.5)
        self.assertAlmostEqual(points[19]['bb_upper'], 10.5 + 2 * math.sqrt(33.25))
        self.assertAlmostEqual(points[19]['bb_bandwidth'], 4 * math.sqrt(33.25) / 10.5)
        self.assertAlmostEqual(points[-1]['squeeze_momentum'], 9.5)
        json.dumps(points, allow_nan=False)

    def test_squeeze_releases_after_volatility_expands(self):
        points = daily_indicator_points(candles([100] * 60 + [150]))
        self.assertIsNone(points[18]['squeeze_state'])
        self.assertIsNone(points[37]['squeeze_momentum'])
        self.assertEqual(points[59]['squeeze_state'], 'ON')
        self.assertEqual(points[59]['squeeze_momentum'], 0)
        self.assertEqual(points[60]['squeeze_state'], 'OFF')
        self.assertTrue(points[60]['squeeze_released'])
        self.assertGreater(points[60]['squeeze_momentum'], 0)

    def test_missing_high_low_does_not_invent_squeeze(self):
        points = daily_indicator_points([{'timestamp': i, 'price': 100} for i in range(60)])
        self.assertEqual(points[-1]['bb_middle'], 100)
        self.assertIsNone(points[-1]['squeeze_state'])
        self.assertIsNone(points[-1]['squeeze_momentum'])
        self.assertIsNone(points[-1]['kc_upper'])
        self.assertEqual(daily_indicator_points([]), [])

    def test_zero_basis_does_not_return_infinity(self):
        points = daily_indicator_points(candles([0] * 60))
        self.assertIsNone(points[-1]['bb_bandwidth'])
        json.dumps(points, allow_nan=False)

    def test_histogram_crossings_match_adjacent_values(self):
        points = daily_indicator_points(candles([100 + 10 * math.sin(i / 8) for i in range(180)]))
        crosses = [i for i, p in enumerate(points) if p['macd_cross']]
        self.assertGreater(len(crosses), 3)
        for index in crosses:
            current, previous = points[index], points[index - 1]
            if current['macd_cross'] == 'BULLISH':
                self.assertLessEqual(previous['histogram'], 0)
                self.assertGreater(current['histogram'], 0)
            else:
                self.assertGreaterEqual(previous['histogram'], 0)
                self.assertLess(current['histogram'], 0)

    @patch('pickinggeek.services.yahoo_finance.httpx.get')
    def test_short_technical_ranges_keep_daily_warmup(self, get):
        response = MagicMock()
        values = list(range(100, 400))
        response.json.return_value = {'chart': {'result': [{
            'meta': {}, 'timestamp': list(range(1, 301)),
            'indicators': {'quote': [{'open': values, 'high': [v + 1 for v in values],
                                     'low': [v - 1 for v in values], 'close': values}]},
        }]}}
        get.return_value = response
        for period, count in [('1D', 1), ('1W', 5)]:
            cache.clear()
            points = get_price_chart('SHORT_TEST', 'TW', period, technical=True)['points']
            self.assertEqual(len(points), count)
            self.assertEqual(points[-1]['timestamp'], 300)
            self.assertIsNotNone(points[0]['bb_upper'])
            self.assertIsNotNone(points[0]['squeeze_momentum'])
            self.assertIsNotNone(points[0]['ma250'])
            self.assertEqual(get.call_args.kwargs['params']['interval'], '1d')
            self.assertIn('period1', get.call_args.kwargs['params'])

    @patch('pickinggeek.services.yahoo_finance.httpx.get')
    def test_yahoo_ohlc_is_preserved_and_missing_values_stay_missing(self, get):
        cache.clear()
        response = MagicMock()
        response.json.return_value = {'chart': {'result': [{
            'meta': {}, 'timestamp': [1, 2, 3], 'indicators': {'quote': [{
                'open': [10, 11, 12], 'high': [12, 13, None], 'low': [9, 10, 11], 'close': [11, None, 12],
            }]},
        }]}}
        get.return_value = response
        points = get_price_chart('OHLC_TEST', 'US', '1M')['points']
        self.assertEqual([p['timestamp'] for p in points], [1, 3])
        self.assertEqual(points[0]['open'], 10)
        self.assertEqual(points[0]['high'], 12)
        self.assertEqual(points[0]['low'], 9)
        self.assertEqual(points[0]['close'], 11)
        self.assertIsNone(points[1]['high'])
