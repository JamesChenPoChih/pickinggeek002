from unittest.mock import patch
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from .models import NotificationQueue, Stock, StockAlert, User, UserStock
from .services.alerts import RULES, evaluate_alert, matches, validate_rules


class AlertRuleTests(SimpleTestCase):
    def test_rejects_malformed_rules(self):
        for rules in [[], None, [{'kind': []}], [{'kind': 'unknown'}],
                      [{'kind': 'ma_cross', 'short': 200, 'long': 20}],
                      [{'kind': 'ma_bias', 'threshold': 0}], [{'kind': 'ma_bias', 'period': 5}],
                      [{'kind': 'bb_width', 'threshold': float('nan')}],
                      [{'kind': 'bb_width', 'threshold': 10 ** 1000}],
                      [{'kind': 'macd_trend', 'days': True}],
                      [{'kind': 'macd_zero', 'direction': 'invalid'}],
                      [{'kind': 'squeeze_on'}, {'kind': 'squeeze_on'}]]:
            with self.subTest(rules=rules), self.assertRaises(ValueError):
                validate_rules(rules)

    def test_all_rule_defaults_are_valid(self):
        for kind in RULES:
            self.assertEqual(validate_rules([{'kind': kind}])[0], {'kind': kind, **RULES[kind]})

    def check(self, kind, previous, current, **parameters):
        rule = validate_rules([{'kind': kind, **parameters}])[0]
        points = [previous, current]
        self.assertTrue(matches(rule, points))
        self.assertFalse(matches(rule, [previous, previous]))
        self.assertFalse(matches(rule, [current]))

    def test_ma_crosses_alignment_and_signed_bias(self):
        self.check('ma_price_cross', {'price': 99, 'ma200': 100}, {'price': 101, 'ma200': 100})
        self.check('ma_price_cross', {'price': 101, 'ma200': 100}, {'price': 99, 'ma200': 100}, direction='DOWN')
        self.check('ma_cross', {'ma20': 99, 'ma60': 100}, {'ma20': 101, 'ma60': 100})
        self.check('ma_cross', {'ma20': 101, 'ma60': 100}, {'ma20': 99, 'ma60': 100}, direction='DOWN')
        self.check('ma_alignment', {'ma5': 99, 'ma20': 101, 'ma60': 100, 'ma200': 90}, {'ma5': 102, 'ma20': 101, 'ma60': 100, 'ma200': 90})
        self.check('ma_alignment', {'ma5': 102, 'ma20': 99, 'ma60': 100, 'ma200': 101}, {'ma5': 98, 'ma20': 99, 'ma60': 100, 'ma200': 101}, direction='DOWN')
        self.check('ma_bias', {'price': 110, 'ma20': 100}, {'price': 120, 'ma20': 100})
        self.check('ma_bias', {'price': 90, 'ma20': 100}, {'price': 80, 'ma20': 100}, threshold=-15)

    def test_macd_cross_and_zero_use_sign_not_colors(self):
        for kind, key in [('macd_cross', 'histogram'), ('macd_zero', 'macd')]:
            self.check(kind, {key: -1}, {key: 1})
            self.check(kind, {key: 1}, {key: -1}, direction='DOWN')
        rule = validate_rules([{'kind': 'macd_trend'}])[0]
        self.assertTrue(matches(rule, [{'histogram': v} for v in [1, 0, 1, 2, 3]]))
        self.assertFalse(matches(rule, [{'histogram': v} for v in [0, 1, 2, 3, 4]]))
        rule['direction'] = 'DOWN'
        self.assertTrue(matches(rule, [{'histogram': v} for v in [0, 1, 0, -1, -2]]))

    def test_bollinger_boundaries_width_middle_and_volume(self):
        self.check('bb_boundary', {'price': 100, 'bb_upper': 101}, {'price': 102, 'bb_upper': 101})
        self.check('bb_boundary', {'price': 100, 'bb_lower': 99}, {'price': 98, 'bb_lower': 99}, direction='DOWN')
        self.check('bb_width', {'bb_bandwidth': 0.06}, {'bb_bandwidth': 0.04})
        self.check('bb_middle', {'price': 105, 'bb_middle': 100}, {'price': 101, 'low': 99, 'bb_middle': 100})
        rule = validate_rules([{'kind': 'bb_expansion'}])[0]
        points = [{'volume': 100} for _ in range(19)] + [
            {'price': 100, 'bb_upper': 101, 'bb_bandwidth': 0.1, 'volume': 100},
            {'price': 102, 'bb_upper': 101, 'bb_bandwidth': 0.13, 'volume': 200}]
        self.assertTrue(matches(rule, points))
        points[-1]['volume'] = 100
        self.assertFalse(matches(rule, points))

    def test_squeeze_on_release_and_momentum(self):
        self.check('squeeze_on', {'squeeze_state': 'OFF'}, {'squeeze_state': 'ON'})
        self.check('squeeze_release', {'squeeze_state': 'ON'}, {'squeeze_state': 'OFF'})
        self.check('squeeze_momentum', {'squeeze_momentum': -1}, {'squeeze_momentum': 1})
        self.check('squeeze_momentum', {'squeeze_momentum': 1}, {'squeeze_momentum': -1}, direction='DOWN')
        rule = validate_rules([{'kind': 'squeeze_momentum'}])[0]
        self.assertTrue(matches(rule, [{'squeeze_momentum': v} for v in [3, 2, 4]]))
        self.assertFalse(matches(rule, [{'squeeze_momentum': v} for v in [1, 2, 4]]))


class AlertApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='alert-user', tier='PRO')
        self.other = User.objects.create_user(username='other-user', tier='PRO')
        self.stock = Stock.objects.create(symbol='TEST', market='US', name='Test')
        UserStock.objects.create(user=self.user, stock=self.stock)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.path = f'/api/stocks/{self.stock.pk}/alert/'

    def test_save_reload_update_and_permissions(self):
        body = {'enabled': True, 'frequency': 'DAILY', 'rules': [{'kind': 'macd_cross'}]}
        response = self.client.put(self.path, body, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get(self.path).data['rules'][0]['direction'], 'UP')
        body['enabled'] = False
        self.assertEqual(self.client.put(self.path, body, format='json').status_code, 200)
        self.assertEqual(StockAlert.objects.count(), 1)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.path).status_code, 404)
        self.assertEqual(self.client.put(self.path, body, format='json').status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.path).status_code, 401)

    def test_invalid_rules_never_persist(self):
        response = self.client.put(self.path, {'frequency': 'ONCE', 'rules': [{'kind': 'ma_cross', 'short': 200, 'long': 20}]}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(StockAlert.objects.exists())
        self.assertEqual(self.client.put(self.path, [], format='json').status_code, 400)

    def test_notifications_are_private_and_mark_read(self):
        NotificationQueue.objects.create(user=self.user, stock=self.stock, title='Mine', body='Test')
        NotificationQueue.objects.create(user=self.other, stock=self.stock, title='Other', body='Test')
        self.assertEqual(self.client.get('/api/notifications/').data['unread'], 1)
        self.assertEqual(self.client.post('/api/notifications/').data['unread'], 0)
        self.assertIsNone(NotificationQueue.objects.get(user=self.other).read_at)

    def test_first_run_seeds_without_retroactive_notification(self):
        alert = StockAlert.objects.create(user=self.user, stock=self.stock, rules=[{'kind': 'macd_cross'}])
        self.assertFalse(evaluate_alert(alert.id, self.chart()))
        alert.refresh_from_db()
        self.assertEqual(alert.last_bar_at, 1700100000)
        self.assertFalse(NotificationQueue.objects.exists())

    def chart(self):
        return {'timezone': 'America/New_York', 'market_state': 'CLOSED', 'points': [
            {'timestamp': 1700000000, 'price': 100, 'histogram': -1},
            {'timestamp': 1700100000, 'price': 110, 'histogram': 1}]}

    def test_once_delivery_disables_and_repeated_checks_do_not_duplicate(self):
        alert = StockAlert.objects.create(user=self.user, stock=self.stock, last_bar_at=1700000000,
            rules=[{'kind': 'macd_cross'}], frequency='ONCE')
        self.assertTrue(evaluate_alert(alert.id, self.chart()))
        self.assertFalse(evaluate_alert(alert.id, self.chart()))
        alert.refresh_from_db()
        self.assertFalse(alert.enabled)
        self.assertEqual(NotificationQueue.objects.count(), 1)

    def test_forming_daily_bar_does_not_trigger(self):
        now = datetime.now(ZoneInfo('America/New_York'))
        yesterday = int((now - timedelta(days=1)).timestamp())
        alert = StockAlert.objects.create(user=self.user, stock=self.stock, last_bar_at=yesterday,
            rules=[{'kind': 'macd_cross'}])
        chart = {'timezone': 'America/New_York', 'market_state': 'REGULAR', 'points': [
            {'timestamp': yesterday - 86400, 'price': 99, 'histogram': -1},
            {'timestamp': yesterday, 'price': 100, 'histogram': -1},
            {'timestamp': int(now.timestamp()), 'price': 110, 'histogram': 1}]}
        self.assertFalse(evaluate_alert(alert.id, chart))
        self.assertFalse(NotificationQueue.objects.exists())

    def test_inactive_user_cannot_receive_new_alerts(self):
        alert = StockAlert.objects.create(user=self.user, stock=self.stock, last_bar_at=1700000000,
            rules=[{'kind': 'macd_cross'}])
        self.user.is_active = False
        self.user.save(update_fields=['is_active'])
        self.assertFalse(evaluate_alert(alert.id, self.chart()))
        self.assertFalse(NotificationQueue.objects.exists())

    def test_daily_frequency_is_limited_by_market_date_and_untracked_stocks_skip(self):
        alert = StockAlert.objects.create(user=self.user, stock=self.stock, last_bar_at=1700000000,
            rules=[{'kind': 'macd_cross'}], frequency='DAILY')
        self.assertTrue(evaluate_alert(alert.id, self.chart()))
        alert.refresh_from_db()
        self.assertTrue(alert.enabled)
        chart = self.chart()
        chart['points'][-1]['timestamp'] += 60
        self.assertFalse(evaluate_alert(alert.id, chart))
        self.assertEqual(NotificationQueue.objects.count(), 1)
        UserStock.objects.filter(user=self.user).delete()
        chart['points'][-1]['timestamp'] += 86400
        self.assertFalse(evaluate_alert(alert.id, chart))

    @patch('pickinggeek.management.commands.evaluate_alerts.get_price_chart')
    def test_command_fetches_once_per_shared_stock(self, get):
        from django.core.management import call_command
        UserStock.objects.create(user=self.other, stock=self.stock)
        for user in [self.user, self.other]:
            StockAlert.objects.create(user=user, stock=self.stock, rules=[{'kind': 'macd_cross'}])
        get.return_value = self.chart()
        call_command('evaluate_alerts')
        self.assertEqual(get.call_count, 1)
