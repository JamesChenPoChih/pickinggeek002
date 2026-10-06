import os
from datetime import date

from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from unittest.mock import patch

from .models import NotificationQueue, Stock, TechnicalIndicatorCache, User, UserStock
from .services.llm_router import LLMRouter, NANO_MODEL, ULTRA_MODEL


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

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="web-client-id.apps.googleusercontent.com")
    @patch("pickinggeek.api.google_id_token.verify_oauth2_token", side_effect=ValueError)
    def test_google_login_rejects_invalid_token(self, _verify_mock):
        response = self.client.post("/api/auth/google/", {"credential": "invalid"}, format="json")
        self.assertEqual(response.status_code, 400)


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
