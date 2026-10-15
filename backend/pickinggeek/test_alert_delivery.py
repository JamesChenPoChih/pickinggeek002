from datetime import datetime, timezone as dt_timezone
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from .models import NotificationQueue, Stock, StockAlert, User, UserStock


class AlertDeliveryTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='delivery', tier='PRO')
        self.other = User.objects.create_user(username='other-delivery')
        self.stock = Stock.objects.create(symbol='TEST', market='US', name='Test Company')
        UserStock.objects.create(user=self.user, stock=self.stock)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.chart = {'timezone': 'America/New_York', 'currency': 'USD', 'market_state': 'CLOSED', 'points': [
            {'timestamp': 1700000000, 'price': 105, 'ma200': 100, 'bb_lower': 101},
            {'timestamp': 1700100000, 'price': 95, 'ma200': 100, 'bb_lower': 99}]}

    def alert(self, user=None, stock=None, **fields):
        return StockAlert.objects.create(user=user or self.user, stock=stock or self.stock,
            rules=[{'kind': 'ma_price_cross', 'period': 200, 'direction': 'DOWN'},
                   {'kind': 'bb_boundary', 'direction': 'DOWN'}],
            last_bar_at=fields.pop('last_bar_at', 1700000000), **fields)

    @patch('pickinggeek.services.alert_checks.get_price_chart')
    def test_live_check_creates_private_summary_and_does_not_duplicate(self, get):
        own = self.alert()
        UserStock.objects.create(user=self.other, stock=self.stock)
        other = self.alert(user=self.other)
        get.return_value = self.chart
        response = self.client.post('/api/alerts/check/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created'], 1)
        notice = NotificationQueue.objects.get()
        self.assertEqual(notice.user, self.user)
        self.assertEqual(notice.payload['symbol'], 'TEST')
        self.assertEqual(notice.payload['snapshot']['ma200'], 100)
        self.assertEqual(notice.payload['snapshot']['bb_lower'], 99)
        self.assertEqual(len(notice.payload['rules']), 2)
        self.assertEqual(notice.payload['currency'], 'USD')
        self.assertTrue(self.client.post('/api/alerts/check/').data['cached'])
        self.assertEqual(get.call_count, 1)
        self.assertEqual(self.client.get('/api/notifications/').data['unread'], 1)
        self.assertEqual(self.client.get('/api/notifications/').data['today_unread'], 1)
        self.assertEqual(self.client.post('/api/notifications/').data['today_unread'], 0)
        own.refresh_from_db(); other.refresh_from_db()
        self.assertFalse(own.enabled)
        self.assertTrue(other.enabled)
        self.assertEqual(other.last_bar_at, 1700000000)

    @patch('pickinggeek.services.alert_checks.get_price_chart')
    def test_first_check_sets_baseline_without_fake_historical_push(self, get):
        self.alert(last_bar_at=None)
        get.return_value = self.chart
        self.assertEqual(self.client.post('/api/alerts/check/').data['created'], 0)
        self.assertFalse(NotificationQueue.objects.exists())

    @patch('pickinggeek.services.alert_checks.get_price_chart')
    def test_failed_market_fetch_does_not_clear_existing_notices(self, get):
        self.alert()
        NotificationQueue.objects.create(user=self.user, stock=self.stock, title='Existing', body='Keep')
        get.side_effect = RuntimeError('provider down')
        response = self.client.post('/api/alerts/check/')
        self.assertEqual(response.data['failed'], 1)
        self.assertEqual(self.client.get('/api/notifications/').data['unread'], 1)

    @patch('pickinggeek.services.alert_checks.get_price_chart')
    def test_bounded_batches_rotate_and_skip_disabled_or_untracked(self, get):
        self.alert(enabled=False)
        for index in range(9):
            stock = Stock.objects.create(symbol=f'CHECK{index}', market='US', name='Check')
            UserStock.objects.create(user=self.user, stock=stock)
            self.alert(stock=stock, last_bar_at=None)
        untracked = Stock.objects.create(symbol='SKIP', market='US', name='Skip')
        self.alert(stock=untracked)
        get.return_value = self.chart
        self.assertEqual(self.client.post('/api/alerts/check/').data['checked'], 8)
        cache.delete(f'alert-check:{self.user.pk}')
        self.assertEqual(self.client.post('/api/alerts/check/').data['checked'], 1)
        self.assertEqual(get.call_count, 9)

    def test_check_requires_login(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post('/api/alerts/check/').status_code, 401)

    def test_watchlist_flags_and_status_are_private_and_persistent(self):
        UserStock.objects.create(user=self.other, stock=self.stock)
        self.alert(user=self.other)
        response = self.client.get('/api/stocks/')
        self.assertFalse(response.data[0]['alert_enabled'])
        own = self.alert()
        self.assertTrue(self.client.get('/api/stocks/').data[0]['alert_enabled'])
        self.assertEqual(self.client.get('/api/notifications/').data['active_alert_stock_ids'], [self.stock.pk])
        own.enabled = False
        own.save(update_fields=['enabled'])
        self.assertFalse(self.client.get('/api/stocks/').data[0]['alert_enabled'])
        self.assertEqual(self.client.get('/api/notifications/').data['active_alert_stock_ids'], [])
        self.client.force_authenticate(self.other)
        self.assertTrue(self.client.get('/api/stocks/').data[0]['alert_enabled'])

    @patch('pickinggeek.alert_api.timezone.now')
    def test_today_uses_browser_timezone_and_only_unread_stock_alerts(self, now):
        now.return_value = datetime(2026, 10, 14, 23, 30, tzinfo=dt_timezone.utc)
        for hour, payload, read in [(17, {'type': 'stock_alert'}, None),
                                    (15, {'type': 'stock_alert'}, None),
                                    (18, {'type': 'billing'}, None),
                                    (19, {'type': 'stock_alert'}, now.return_value)]:
            notice = NotificationQueue.objects.create(user=self.user, stock=self.stock, title='Notice', body='Body', payload=payload, read_at=read)
            NotificationQueue.objects.filter(pk=notice.pk).update(created_at=datetime(2026, 10, 14, hour, tzinfo=dt_timezone.utc))
        response = self.client.get('/api/notifications/?timezone=Asia%2FTaipei')
        self.assertEqual(response.data['today_unread'], 1)
        self.assertEqual(response.data['unread'], 3)
