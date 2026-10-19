import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone as dt_timezone
from io import StringIO
from threading import Barrier
from time import sleep
from unittest.mock import patch

from django.core.cache import cache
from django.core.management import call_command, CommandError
from django.db import IntegrityError, OperationalError, close_old_connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import DemoAccount, Stock, User, UserStock
from .services.demo_quota import DemoQuotaExceeded, reserve_analysis, usage_for


@override_settings(TIME_ZONE='Asia/Taipei')
class DemoQuotaTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.user = User.objects.create_user('Demo', password='test-password', tier=User.Tier.PRO)
        self.demo = DemoAccount.objects.create(user=self.user)
        self.stock = Stock.objects.create(symbol='NVDA', market='US', name='NVIDIA')
        UserStock.objects.create(user=self.user, stock=self.stock)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_independent_daily_limits_are_durable_and_account_scoped(self):
        for _ in range(20):
            reserve_analysis(self.user, 'quick')
        for _ in range(3):
            reserve_analysis(self.user, 'deep')
        cache.clear()
        fresh_user = User.objects.get(pk=self.user.pk)
        for mode in ('quick', 'deep'):
            with self.assertRaises(DemoQuotaExceeded):
                reserve_analysis(fresh_user, mode)
        self.demo.refresh_from_db()
        self.assertEqual((self.demo.pro_used, self.demo.ultra_used), (20, 3))
        other = User.objects.create_user('other', tier=User.Tier.PRO)
        for _ in range(25):
            reserve_analysis(other, 'deep')
        self.assertEqual(usage_for(other), {'limited': False})

    def test_taipei_midnight_resets_both_counters(self):
        before = datetime(2026, 10, 18, 15, 59, tzinfo=dt_timezone.utc)
        after = datetime(2026, 10, 18, 16, 0, tzinfo=dt_timezone.utc)
        with patch('pickinggeek.services.demo_quota.timezone.now', return_value=before):
            self.demo.usage_date = timezone.localdate(before)
            self.demo.pro_used, self.demo.ultra_used = 20, 3
            self.demo.save()
            with self.assertRaises(DemoQuotaExceeded):
                reserve_analysis(self.user, 'deep')
        with patch('pickinggeek.services.demo_quota.timezone.now', return_value=after):
            self.assertEqual(usage_for(self.user)['quick']['remaining'], 20)
            reserve_analysis(self.user, 'deep')
            self.demo.refresh_from_db()
            self.assertEqual((self.demo.pro_used, self.demo.ultra_used), (0, 1))

    @patch('pickinggeek.api.build_analysis_context')
    @patch('pickinggeek.api.LLMRouter')
    def test_exhausted_auto_ultra_rejected_before_provider_or_market_work(self, router, context):
        self.demo.ultra_used = 3
        self.demo.save()
        for mode in ('deep', 'auto'):
            response = self.client.post('/api/ai/analyze/', {
                'question': 'Please assess risk and strategy', 'stock_id': self.stock.pk,
                'mode': mode, 'language': 'en',
            }, format='json')
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.data['code'], 'daily_demo_limit')
        router.assert_not_called()
        context.assert_not_called()

    @patch('pickinggeek.api.build_analysis_context', return_value={'target': {}, 'comparisons': []})
    @patch('pickinggeek.api.LLMRouter')
    def test_accepted_analysis_is_counted_once_even_if_stream_is_replayed_locally(self, router, context):
        router.return_value.stream.return_value = [{'type': 'token', 'content': 'Research'}]
        response = self.client.post('/api/ai/analyze/', {
            'question': 'Explain MA', 'stock_id': self.stock.pk, 'mode': 'quick',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        body = b''.join(response.streaming_content)
        self.assertIn(b'Research', body)
        self.demo.refresh_from_db()
        self.assertEqual(self.demo.pro_used, 1)
        self.assertEqual(self.demo.ultra_used, 0)

    def test_invalid_or_unwatched_requests_are_not_counted(self):
        self.client.post('/api/ai/analyze/', {}, format='json')
        UserStock.objects.filter(user=self.user).delete()
        response = self.client.post('/api/ai/analyze/', {
            'question': 'Explain MA', 'stock_id': self.stock.pk, 'mode': 'quick',
        }, format='json')
        self.assertEqual(response.status_code, 403)
        self.demo.refresh_from_db()
        self.assertEqual(self.demo.pro_used, 0)

    def test_usage_endpoint_is_private_and_user_cannot_enter_admin(self):
        self.assertEqual(self.client.get('/api/ai/usage/').data['quick']['limit'], 20)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/ai/usage/').status_code, 401)
        self.assertTrue(self.client.login(username='Demo', password='test-password'))
        self.assertEqual(self.client.get('/admin/').status_code, 302)
        self.assertFalse(self.user.has_perm('pickinggeek.change_user'))

    def test_database_rejects_counts_outside_policy(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            DemoAccount.objects.filter(pk=self.demo.pk).update(ultra_used=4)

    def test_configure_command_normalizes_name_hashes_password_and_preserves_usage(self):
        self.user.username = 'demo'
        self.user.save()
        self.demo.pro_used = 5
        self.demo.save()
        with patch.dict(os.environ, {'DEMO_ACCOUNT_PASSWORD': 'new-demo-test-password'}):
            call_command('configure_demo', stdout=StringIO())
        self.user.refresh_from_db()
        self.demo.refresh_from_db()
        self.assertEqual(self.user.username, 'Demo')
        self.assertTrue(self.user.check_password('new-demo-test-password'))
        self.assertNotEqual(self.user.password, 'new-demo-test-password')
        self.assertFalse(self.user.is_staff or self.user.is_superuser)
        self.assertEqual(self.user.tier, User.Tier.PRO)
        self.assertEqual(self.demo.pro_used, 5)

    def test_configure_refuses_administrator(self):
        self.user.is_staff = self.user.is_superuser = True
        self.user.save()
        with patch.dict(os.environ, {'DEMO_ACCOUNT_PASSWORD': 'new-demo-test-password'}):
            with self.assertRaises(CommandError):
                call_command('configure_demo', stdout=StringIO())
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('test-password'))

    def test_new_name_leaves_existing_administrator_untouched(self):
        self.user.is_staff = self.user.is_superuser = True
        self.user.save()
        with patch.dict(os.environ, {'DEMO_ACCOUNT_PASSWORD': 'new-demo-test-password'}):
            call_command('configure_demo', username='DemoGuest', stdout=StringIO())
        guest = User.objects.get(username='DemoGuest')
        self.assertFalse(guest.is_staff or guest.is_superuser)
        self.assertTrue(DemoAccount.objects.filter(user=guest).exists())
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_staff and self.user.is_superuser)
        self.assertTrue(self.user.check_password('test-password'))


class DemoConcurrencyTests(TransactionTestCase):
    def test_two_requests_cannot_both_take_the_last_ultra_slot(self):
        user = User.objects.create_user('parallel-demo', tier=User.Tier.PRO)
        account = DemoAccount.objects.create(user=user, ultra_used=2)
        barrier = Barrier(2)

        def attempt():
            close_old_connections()
            try:
                actor = User.objects.get(pk=user.pk)
                barrier.wait(timeout=5)
                # SQLite shared-cache tests may report a table lock instead of waiting.
                for retry in range(10):
                    try:
                        reserve_analysis(actor, 'deep')
                        return 'accepted'
                    except DemoQuotaExceeded:
                        return 'denied'
                    except OperationalError as exc:
                        if 'locked' not in str(exc).lower() or retry == 9:
                            raise
                        sleep(0.01)
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: attempt(), range(2)))
        self.assertCountEqual(results, ['accepted', 'denied'])
        account.refresh_from_db()
        self.assertEqual(account.ultra_used, 3)
