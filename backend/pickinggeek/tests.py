import os
from datetime import date, timedelta

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from unittest.mock import patch

from .models import NotificationQueue, Stock, TechnicalIndicatorCache, User, UserStock
from .services.llm_router import LLMRouter, NANO_MODEL, ULTRA_MODEL
from .services.yahoo_finance import daily_indicator_points, get_price_chart, search_market_assets, YahooFinanceError
from .services.native_names import native_stock_name


class NativeNameTests(SimpleTestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.addCleanup(cache.clear)

    @patch('pickinggeek.services.native_names.httpx.get')
    def test_chinese_name_is_cached_and_used_for_existing_stock(self, get_mock):
        from .serializers import StockSerializer
        get_mock.return_value.text = '<meta property="og:title" content="台積電(2330.TW) 走勢圖 - Yahoo股市">'
        stock = Stock(symbol='2330', market='TW', name='Taiwan Semiconductor', currency='TWD')
        self.assertEqual(StockSerializer(stock).data['name'], '台積電')
        self.assertEqual(native_stock_name('2330.TW', 'TW', stock.name), '台積電')
        self.assertEqual(get_mock.call_count, 1)

    @patch('pickinggeek.services.native_names.httpx.get')
    def test_original_english_and_chinese_are_preserved(self, get_mock):
        self.assertEqual(native_stock_name('NVDA', 'US', 'NVIDIA Corporation'), 'NVIDIA Corporation')
        self.assertEqual(native_stock_name('2330', 'TW', '台積電'), '台積電')
        get_mock.assert_not_called()

    @patch('pickinggeek.services.native_names.httpx.get')
    def test_wrong_symbol_metadata_falls_back(self, get_mock):
        get_mock.return_value.text = '<meta property="og:title" content="其他公司(9999.TW) 走勢圖">'
        self.assertEqual(native_stock_name('2330', 'TW', 'English name'), 'English name')

    @patch('pickinggeek.services.native_names.httpx.get')
    def test_network_failure_falls_back_and_is_cached(self, get_mock):
        import httpx
        get_mock.side_effect = httpx.ConnectError('unavailable')
        self.assertEqual(native_stock_name('6488.TWO', 'TW', 'GlobalWafers'), 'GlobalWafers')
        self.assertEqual(native_stock_name('6488.TWO', 'TW', 'GlobalWafers'), 'GlobalWafers')
        self.assertEqual(get_mock.call_count, 1)


class TaiwanSearchTests(TestCase):
    def setUp(self):
        for target in ['pickinggeek.api.native_stock_name', 'pickinggeek.serializers.native_stock_name']:
            patcher = patch(target, side_effect=lambda symbol, market, fallback: fallback)
            patcher.start()
            self.addCleanup(patcher.stop)
        from django.core.cache import cache
        cache.clear()
        self.addCleanup(cache.clear)
        self.user = User.objects.create_user(username='taiwan', tier=User.Tier.PRO)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    @patch('pickinggeek.services.yahoo_finance.httpx.get')
    def test_chinese_search_resolves_stocks_etfs_and_filters_warrants(self, get_mock):
        from unittest.mock import Mock
        def response(url, **kwargs):
            result = Mock()
            if 'AutocompleteService' in url:
                result.json.return_value = {'ResultSet': {'Result': [
                    {'symbol': '2330.TW', 'name': '台積電'},
                    {'symbol': '2330.TW', 'name': '台積電'},
                    {'symbol': '056552.TW', 'name': '台積電權證'},
                    {'symbol': '00631L.TW', 'name': '元大台灣50正2'},
                    {'symbol': '6488.TWO', 'name': '環球晶'},
                ]}}
            else:
                symbol = kwargs['params']['q']
                result.json.return_value = {'quotes': [{'symbol': symbol,
                    'longname': 'English name', 'quoteType': 'ETF' if symbol.startswith('00') else 'EQUITY'}]}
            return result
        get_mock.side_effect = response
        results = search_market_assets('台', market='TW')
        self.assertEqual([a['symbol'] for a in results], ['2330.TW', '00631L.TW', '6488.TWO'])
        self.assertEqual(results[0]['name'], '台積電')
        self.assertEqual(results[1]['asset_type'], 'ETF')
        self.assertEqual(search_market_assets('台', market='TW'), results)
        self.assertEqual(get_mock.call_count, 4)

    @patch('pickinggeek.services.yahoo_finance.httpx.get')
    def test_chinese_search_empty_or_malformed_response(self, get_mock):
        get_mock.return_value.json.return_value = {'ResultSet': {'Result': []}}
        self.assertEqual(search_market_assets('不存在', market='TW'), [])
        get_mock.return_value.json.return_value = {'error': 'bad response'}
        with self.assertRaises(YahooFinanceError):
            search_market_assets('錯誤', market='TW')

    @patch('pickinggeek.services.yahoo_finance.httpx.get')
    def test_search_filters_markets_and_separates_cache(self, get_mock):
        get_mock.return_value.json.return_value = {'quotes': [
            {'symbol': '2330.TW', 'exchange': 'TAI', 'quoteType': 'EQUITY'},
            {'symbol': '6488.TWO', 'exchange': 'TWO', 'quoteType': 'EQUITY'},
            {'symbol': '0050.TW', 'exchange': 'TAI', 'quoteType': 'ETF'},
            {'symbol': 'NVDA', 'exchange': 'NMS', 'quoteType': 'EQUITY'},
        ]}
        taiwan = search_market_assets('test', market='TW')
        self.assertEqual([a['symbol'] for a in taiwan], ['2330.TW', '6488.TWO', '0050.TW'])
        self.assertTrue(all(a['currency'] == 'TWD' for a in taiwan))
        self.assertTrue(all(a['yahoo_url'].startswith('https://tw.stock.yahoo.com/') for a in taiwan))
        self.assertEqual([a['symbol'] for a in search_market_assets('test')], ['NVDA'])
        self.assertEqual(get_mock.call_count, 2)

    @patch('pickinggeek.api.get_market_asset')
    def test_add_taiwan_preserves_market_currency_and_otc_suffix(self, asset_mock):
        listed = Stock.objects.create(symbol='2330', market='TW', name='Existing', currency='TWD')
        for symbol in ['2330.TW', '6488.TWO']:
            asset_mock.return_value = {'symbol': symbol, 'name': 'Taiwan company', 'market': 'TW'}
            response = self.client.post('/api/watchlist/yahoo/', {'symbol': symbol, 'market': 'TW'}, format='json')
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.data['market'], 'TW')
            self.assertEqual(response.data['currency'], 'TWD')
            self.assertEqual(response.data['symbol'], symbol.removesuffix('.TW'))
            if symbol == '2330.TW':
                self.assertEqual(response.data['id'], listed.id)
            asset_mock.assert_called_with(symbol, market='TW')
        duplicate = self.client.post('/api/watchlist/yahoo/', {'symbol': '6488.TWO', 'market': 'TW'}, format='json')
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(UserStock.objects.filter(user=self.user).count(), 2)

    def test_rejects_unknown_market(self):
        self.assertEqual(self.client.get('/api/stocks/search/', {'q': '2330', 'market': 'INVALID'}).status_code, 400)
        self.assertEqual(self.client.post('/api/watchlist/yahoo/', {'symbol': '2330.TW', 'market': 'INVALID'}, format='json').status_code, 400)

    @patch('pickinggeek.services.yahoo_finance.httpx.get')
    def test_chart_does_not_duplicate_taiwan_suffix(self, get_mock):
        get_mock.return_value.json.return_value = {'chart': {'result': [{
            'meta': {'currency': 'TWD'}, 'timestamp': [1000, 2000],
            'indicators': {'quote': [{'close': [100, 101]}]},
        }]}}
        for symbol, expected in [('2330', '2330.TW'), ('2330.TW', '2330.TW'), ('6488.TWO', '6488.TWO')]:
            from django.core.cache import cache
            cache.clear()
            get_price_chart(symbol, 'TW', '1D')
            self.assertTrue(get_mock.call_args.args[0].endswith('/' + expected))


class DailyIndicatorTests(SimpleTestCase):
    def test_averages_require_full_daily_windows(self):
        points = [{'timestamp': index * 86400, 'price': float(index + 1)} for index in range(300)]
        result = daily_indicator_points(points)
        self.assertIsNone(result[58]['ma60'])
        self.assertEqual(result[59]['ma60'], 30.5)
        self.assertIsNone(result[248]['ma250'])
        self.assertEqual(result[249]['ma250'], 125.5)
        self.assertEqual(result[-1]['ma200'], 200.5)
        self.assertIsNone(result[32]['macd_signal'])
        self.assertAlmostEqual(result[-1]['histogram'], result[-1]['macd'] - result[-1]['macd_signal'])

    def test_flat_prices_produce_zero_macd(self):
        points = [{'timestamp': index * 86400, 'price': 100.0} for index in range(300)]
        result = daily_indicator_points(points)
        self.assertEqual(result[-1]['ma250'], 100)
        self.assertEqual(result[-1]['macd'], 0)
        self.assertEqual(result[-1]['macd_signal'], 0)

    @patch('pickinggeek.services.yahoo_finance.httpx.get')
    def test_technical_request_warms_up_before_cropping(self, get_mock):
        from django.core.cache import cache
        cache.clear()
        now = timezone.now().replace(hour=16, minute=0, second=0, microsecond=0)
        timestamps = [int((now - timedelta(days=400-index)).timestamp()) for index in range(400)]
        get_mock.return_value.json.return_value = {'chart': {'result': [{
            'meta': {'currency': 'USD', 'exchangeTimezoneName': 'UTC'},
            'timestamp': timestamps,
            'indicators': {'quote': [{'close': [100.0] * 400}]},
        }]}}
        result = get_price_chart('TEST', 'US', '1M', technical=True)
        self.assertLess(len(result['points']), 33)
        self.assertEqual(result['points'][0]['ma250'], 100)
        self.assertEqual(get_mock.call_args.kwargs['params']['interval'], '1d')
        self.assertIn('period1', get_mock.call_args.kwargs['params'])
        cache.clear()

    def test_technical_mode_rejects_intraday_ranges(self):
        with self.assertRaises(ValueError):
            get_price_chart('TEST', 'US', '1D', technical=True)


class RenderDeploymentTests(TestCase):
    def test_api_status_reports_service_status(self):
        response = self.client.get("/api/status/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["service"], "Picking Geek API")

    def test_health_check_verifies_database(self):
        response = self.client.get("/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "healthy", "database": "connected"})


class GoogleLoginTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="web-client-id.apps.googleusercontent.com")
    def test_google_auth_config_is_available_without_login(self):
        response = self.client.get("/api/auth/google/config/")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["enabled"])
        self.assertEqual(response.data["client_id"], "web-client-id.apps.googleusercontent.com")

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="web-client-id.apps.googleusercontent.com")
    @patch("pickinggeek.api.google_id_token.verify_oauth2_token")
    def test_google_login_creates_user_and_returns_jwt(self, verify_mock):
        verify_mock.return_value = {
            "sub": "google-account-123",
            "email": "investor@example.com",
            "email_verified": True,
            "given_name": "Market",
            "family_name": "Investor",
            "picture": "https://example.com/avatar.jpg",
        }

        response = self.client.post("/api/auth/google/", {"credential": "valid-id-token"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)
        user = User.objects.get(google_subject="google-account-123")
        self.assertEqual(user.email, "investor@example.com")
        self.assertFalse(user.has_usable_password())
        self.assertIsNotNone(user.last_login)
        self.assertTrue(timezone.is_aware(user.last_login))

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="web-client-id.apps.googleusercontent.com")
    @patch("pickinggeek.api.google_id_token.verify_oauth2_token")
    def test_repeat_google_login_updates_last_login_without_duplicate_user(self, verify_mock):
        old_login = timezone.now() - timedelta(days=1)
        user = User.objects.create_user(
            username="google-account", google_subject="google-account-123",
            email="investor@example.com", last_login=old_login,
        )
        verify_mock.return_value = {
            "sub": "google-account-123",
            "email": "investor@example.com",
            "email_verified": True,
        }

        before_login = timezone.now()
        response = self.client.post("/api/auth/google/", {"credential": "valid-id-token"}, format="json")

        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertGreaterEqual(user.last_login, before_login)
        self.assertLessEqual(user.last_login, timezone.now())
        self.assertEqual(User.objects.filter(google_subject="google-account-123").count(), 1)

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="web-client-id.apps.googleusercontent.com")
    @patch("pickinggeek.api.google_id_token.verify_oauth2_token", side_effect=ValueError)
    def test_google_login_rejects_invalid_token(self, _verify_mock):
        old_login = timezone.now() - timedelta(days=1)
        user = User.objects.create_user(
            username="existing-google-user", google_subject="google-account-123",
            last_login=old_login,
        )
        response = self.client.post("/api/auth/google/", {"credential": "invalid"}, format="json")
        self.assertEqual(response.status_code, 400)
        user.refresh_from_db()
        self.assertEqual(user.last_login, old_login)


class TierLimitTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="free", password="test", tier=User.Tier.FREE)
        self.apple = Stock.objects.create(symbol="AAPL", market="US", name="Apple")
        self.nvidia = Stock.objects.create(symbol="NVDA", market="US", name="NVIDIA")

    def test_free_user_can_only_track_one_stock(self):
        UserStock.objects.create(user=self.user, stock=self.apple)
        with self.assertRaises(ValidationError):
            UserStock.objects.create(user=self.user, stock=self.nvidia)


class RouterTests(TestCase):
    def setUp(self):
        os.environ["NEBIUS_API_KEY"] = "test-key"
        self.router = LLMRouter()

    def test_simple_question_uses_nano(self):
        self.assertEqual(self.router.choose_model("MACD 是多少？").model, NANO_MODEL)

    def test_risk_question_uses_ultra(self):
        self.assertEqual(self.router.choose_model("請做完整風險與策略分析").model, ULTRA_MODEL)


class IndicatorWebhookTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="pro", password="test", tier=User.Tier.PRO)
        self.stock = Stock.objects.create(symbol="AAPL", market="US", name="Apple")
        UserStock.objects.create(user=self.user, stock=self.stock)
        self.payload = {
            "symbol": "AAPL", "market": "US", "as_of_date": str(date.today()),
            "close": 224.31, "macd": 4.8, "signal": 4.1, "histogram": 0.7,
            "macd_status": "BULLISH", "ma60": 204.66, "ma100": 195.82,
            "ma200": 185.42, "above_ma60": True, "above_ma100": True,
            "above_ma200": True, "summary": "測試訊號摘要",
        }

    @override_settings()
    def test_webhook_updates_cache_and_enqueues_notification(self):
        with self.settings():
            os.environ["JOB_WEBHOOK_SECRET"] = "job-test"
            response = self.client.post(
                "/api/internal/indicators/",
                self.payload,
                format="json",
                HTTP_X_JOB_SECRET="job-test",
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(TechnicalIndicatorCache.objects.filter(stock=self.stock).exists())
        self.assertEqual(NotificationQueue.objects.filter(user=self.user).count(), 1)

    def test_webhook_rejects_bad_secret(self):
        os.environ["JOB_WEBHOOK_SECRET"] = "job-test"
        response = self.client.post(
            "/api/internal/indicators/", self.payload, format="json", HTTP_X_JOB_SECRET="wrong"
        )
        self.assertEqual(response.status_code, 403)


class YahooStockSearchTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="searcher", password="test")
        self.client.force_authenticate(self.user)

    @patch("pickinggeek.api.enrich_market_assets")
    @patch("pickinggeek.api.search_market_assets")
    def test_search_returns_us_equities(self, search_mock, enrich_mock):
        search_mock.return_value = [{
            "symbol": "MSFT",
            "name": "Microsoft Corporation",
            "exchange": "NMS",
            "exchange_name": "NASDAQ",
            "sector": "Technology",
            "asset_type": "STOCK",
            "yahoo_url": "https://finance.yahoo.com/quote/MSFT",
        }]
        enrich_mock.side_effect = lambda assets: [{
            **assets[0], "price": 429.17, "change_percent": 1.25, "currency": "USD",
            "market_state": "REGULAR", "updated_at": 1,
        }]
        response = self.client.get("/api/stocks/search/", {"q": "micro"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["symbol"], "MSFT")
        self.assertEqual(response.data["results"][0]["price"], 429.17)

    def test_empty_search_does_not_call_yahoo(self):
        response = self.client.get("/api/stocks/search/", {"q": ""})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"results": []})

    def test_stock_list_creates_default_watchlist_for_new_user(self):
        response = self.client.get("/api/stocks/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["symbol"] for item in response.data], ["NVDA"])
        self.assertTrue(UserStock.objects.filter(user=self.user, stock__symbol="NVDA").exists())

    @patch("pickinggeek.api.get_price_chart")
    def test_stock_chart_returns_yahoo_prices(self, chart_mock):
        stock = Stock.objects.create(symbol="NVDA", market="US", name="NVIDIA")
        chart_mock.return_value = {
            "symbol": "NVDA", "range": "1D", "currency": "USD",
            "timezone": "America/New_York", "previous_close": 220,
            "current_price": 222, "points": [{"timestamp": 1, "price": 222}],
        }
        response = self.client.get(f"/api/stocks/{stock.id}/chart/", {"range": "1D"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["points"][0]["price"], 222)

    @patch("pickinggeek.api.get_market_asset")
    def test_add_yahoo_asset_to_watchlist(self, asset_mock):
        self.user.tier = User.Tier.PRO
        self.user.save(update_fields=["tier"])
        asset_mock.return_value = {
            "symbol": "MSFT", "name": "Microsoft Corporation", "exchange": "NMS",
            "exchange_name": "NASDAQ", "sector": "Technology", "asset_type": "STOCK",
            "yahoo_url": "https://finance.yahoo.com/quote/MSFT",
        }

        response = self.client.post("/api/watchlist/yahoo/", {"symbol": "msft"}, format="json")
        self.assertEqual(response.status_code, 201)
        stock = Stock.objects.get(symbol="MSFT", market=Stock.Market.US)
        self.assertTrue(UserStock.objects.filter(user=self.user, stock=stock).exists())
        self.assertEqual(response.data["symbol"], "MSFT")

        duplicate = self.client.post("/api/watchlist/yahoo/", {"symbol": "MSFT"}, format="json")
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(UserStock.objects.filter(user=self.user, stock=stock).count(), 1)

        removed = self.client.delete(f"/api/watchlist/stocks/{stock.id}/")
        self.assertEqual(removed.status_code, 204)
        self.assertFalse(UserStock.objects.filter(user=self.user, stock=stock).exists())

    def test_stock_list_only_contains_current_users_watchlist(self):
        mine = Stock.objects.create(symbol="AAPL", market="US", name="Apple")
        other = Stock.objects.create(symbol="GOOG", market="US", name="Alphabet")
        UserStock.objects.create(user=self.user, stock=mine)
        another_user = User.objects.create_user(username="other", password="test")
        UserStock.objects.create(user=another_user, stock=other)

        response = self.client.get("/api/stocks/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["symbol"] for item in response.data], ["AAPL"])
