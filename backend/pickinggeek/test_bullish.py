from unittest.mock import patch
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from .models import User, UserStock, Stock
from .services.bullish import bullish_assessment


def snapshot():
    return {'status': 'available', 'close': 10, 'indicators': {
        'ma20': 9, 'ma60': 8, 'ma200': 7, 'macd': 2, 'macd_signal': 1, 'histogram': 1,
        'bb_middle': 9, 'squeeze_state': 'OFF', 'squeeze_momentum': 2},
        'previous_indicators': {'squeeze_momentum': 1}}


class BullishRuleTests(SimpleTestCase):
    def test_all_four_and_three_votes(self):
        data = snapshot()
        self.assertEqual(bullish_assessment(data)['score'], 4)
        data['indicators']['ma20'] = 11
        result = bullish_assessment(data)
        self.assertEqual(result['score'], 3)
        self.assertEqual(result['status'], 'bullish')
        data['indicators']['squeeze_state'] = 'ON'
        self.assertEqual(bullish_assessment(data)['status'], 'neutral')

    def test_missing_and_nonfinite_data_is_excluded(self):
        for value in (None, float('nan'), float('inf'), True):
            data = snapshot()
            data['indicators']['ma200'] = value
            self.assertEqual(bullish_assessment(data)['status'], 'unavailable')
        data = snapshot()
        data['previous_indicators'] = {}
        self.assertEqual(bullish_assessment(data)['status'], 'unavailable')

    def test_macd_above_zero_and_squeeze_strengthening(self):
        data = snapshot()
        data['indicators']['macd'] = -1
        data['indicators']['macd_signal'] = -2
        data['indicators']['squeeze_momentum'] = .5
        result = bullish_assessment(data)
        self.assertFalse(result['signals']['MACD'])
        self.assertFalse(result['signals']['Squeeze'])
        self.assertEqual(result['status'], 'neutral')


class BullishApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='bullish-user', tier=User.Tier.PRO)
        self.client.force_authenticate(self.user)

    @patch('pickinggeek.api.stock_assessment')
    def test_summary_counts_stocks_not_indicators_and_is_private(self, assessment):
        assessment.side_effect = lambda stock: {'id': stock.id, 'symbol': stock.symbol, 'status': 'bullish', 'score': 4, 'signals': {}}
        for symbol in ('AAPL', 'NVDA', 'VOO', 'QQQ'):
            stock = Stock.objects.create(symbol=symbol, market='US', name=symbol)
            UserStock.objects.create(user=self.user, stock=stock)
        other = User.objects.create_user(username='other-bullish-user')
        private = Stock.objects.create(symbol='NBIS', market='US', name='Nebius')
        UserStock.objects.create(user=other, stock=private)
        response = self.client.get('/api/stocks/bullish-summary/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 4)
        self.assertEqual(len(response.data['stocks']), 4)
        self.assertEqual(assessment.call_count, 4)
        self.assertNotIn('NBIS', [item['symbol'] for item in response.data['stocks']])

    def test_login_required(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/stocks/bullish-summary/').status_code, 401)

    def test_empty_watchlist(self):
        response = self.client.get('/api/stocks/bullish-summary/')
        self.assertEqual(response.data['count'], 0)
        self.assertEqual(response.data['stocks'], [])
