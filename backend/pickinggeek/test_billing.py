import hashlib
import hmac
import json
import time
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .billing import price_tier
from .models import BillingAccount, User


def price(tier="PRO"):
    return {"id": "price_pro" if tier == "PRO" else "price_premium", "livemode": False,
            "currency": "usd", "unit_amount": 999 if tier == "PRO" else 3999,
            "recurring": {"interval": "month", "interval_count": 1}, "active": True}


def subscription(status="active", tier="PRO"):
    return {"id": "sub_test", "livemode": False, "status": status, "created": 100,
            "cancel_at_period_end": False,
            "items": {"data": [{"price": price(tier), "quantity": 1, "current_period_end": 2000000000}]}}


@override_settings(STRIPE_SECRET_KEY="sk_test_example", STRIPE_WEBHOOK_SECRET="whsec_example",
                   STRIPE_PRO_PRICE_ID="price_pro", STRIPE_PREMIUM_PRICE_ID="price_premium",
                   BILLING_FRONTEND_URL="http://127.0.0.1:5174")
class BillingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("payer", email="payer@example.com")
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.account = BillingAccount.objects.create(user=self.user, customer_id="cus_test")
        self.stripe = MagicMock()
        self.stripe.subscriptions.list.return_value.auto_paging_iter.side_effect = lambda: iter(self.subscriptions)
        self.subscriptions = []
        self.patcher = patch("pickinggeek.billing.client", return_value=self.stripe)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def refresh(self):
        return self.api.post("/api/billing/", {}, format="json")

    def test_auth_required(self):
        self.api.force_authenticate(None)
        self.assertEqual(self.api.post("/api/billing/checkout/", {"tier": "PRO"}).status_code, 401)

    def test_basic_cannot_create_checkout(self):
        self.assertEqual(self.api.post("/api/billing/checkout/", {"tier": "FREE"}).status_code, 400)
        self.stripe.checkout.sessions.create.assert_not_called()

    def test_manual_tier_preserved_without_subscription(self):
        self.user.tier = "PRO"
        self.user.save()
        self.assertEqual(self.refresh().data["user"]["tier"], "PRO")

    def test_premium_upgrade_and_payment_failure_downgrade(self):
        self.subscriptions = [subscription(tier="PREMIUM")]
        self.assertEqual(self.refresh().data["user"]["tier"], "PREMIUM")
        self.user.refresh_from_db()
        self.assertTrue(self.user.can_track_unlimited_stocks)
        self.subscriptions[0]["status"] = "unpaid"
        self.assertEqual(self.refresh().data["user"]["tier"], "FREE")

    def test_scheduled_cancellation_keeps_access_until_end(self):
        sub = subscription()
        sub["cancel_at_period_end"] = True
        self.subscriptions = [sub]
        state = self.refresh().data
        self.assertEqual(state["user"]["tier"], "PRO")
        self.assertTrue(state["cancel_at_period_end"])
        sub["status"] = "canceled"
        self.assertEqual(self.refresh().data["user"]["tier"], "FREE")

    def test_checkout_cannot_duplicate_subscription(self):
        self.subscriptions = [subscription()]
        self.assertEqual(self.api.post("/api/billing/checkout/", {"tier": "PREMIUM"}).status_code, 409)
        self.stripe.checkout.sessions.create.assert_not_called()

    def test_checkout_uses_server_price_and_fixed_return_url(self):
        p = MagicMock(id="price_pro")
        p.get.side_effect = price().get
        self.stripe.prices.retrieve.return_value = p
        self.stripe.checkout.sessions.create.return_value = MagicMock(id="cs_test", url="https://checkout.stripe.com/test")
        response = self.api.post("/api/billing/checkout/", {"tier": "PRO", "amount": 1, "success_url": "https://evil.example"})
        self.assertEqual(response.status_code, 200)
        params = self.stripe.checkout.sessions.create.call_args.args[0]
        self.assertEqual(params["line_items"], [{"price": "price_pro", "quantity": 1}])
        self.assertEqual(params["success_url"], "http://127.0.0.1:5174/?billing=return")
        self.user.refresh_from_db()
        self.assertEqual(self.user.tier, "FREE")
        self.stripe.checkout.sessions.retrieve.return_value = MagicMock(status="open", metadata={"tier": "PRO"}, url=response.data["url"])
        self.assertEqual(self.api.post("/api/billing/checkout/", {"tier": "PRO"}).status_code, 200)
        self.assertEqual(self.stripe.checkout.sessions.create.call_count, 1)

    def test_price_validation(self):
        for field, value in [("unit_amount", 1), ("currency", "twd"), ("livemode", True)]:
            self.assertIsNone(price_tier({**price(), field: value}))

    def test_portal_customer_cannot_be_spoofed(self):
        self.stripe.billing_portal.sessions.create.return_value = MagicMock(url="https://billing.stripe.com/test")
        self.assertEqual(self.api.post("/api/billing/portal/", {"customer": "cus_victim"}).status_code, 200)
        self.assertEqual(self.stripe.billing_portal.sessions.create.call_args.args[0]["customer"], "cus_test")

    def send_event(self, **overrides):
        payload = json.dumps({"id": "evt_test", "object": "event", "type": "customer.subscription.updated", "livemode": False,
                              "data": {"object": {"customer": "cus_test"}}, **overrides})
        timestamp = int(time.time())
        signature = hmac.new(b"whsec_example", f"{timestamp}.{payload}".encode(), hashlib.sha256).hexdigest()
        return self.api.post("/api/billing/webhook/", payload, content_type="application/json",
                             HTTP_STRIPE_SIGNATURE=f"t={timestamp},v1={signature}")

    def test_webhook_signature_required(self):
        self.assertEqual(self.api.post("/api/billing/webhook/", {}, format="json").status_code, 400)

    def test_duplicate_and_late_webhooks_use_current_stripe_state(self):
        self.subscriptions = [subscription(tier="PREMIUM")]
        for _ in range(2):
            self.assertEqual(self.send_event().status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.tier, "PREMIUM")
        self.subscriptions[0]["status"] = "canceled"
        self.assertEqual(self.send_event(type="checkout.session.completed").status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.tier, "FREE")

    def test_live_webhook_rejected(self):
        self.assertEqual(self.send_event(livemode=True).status_code, 400)

    @override_settings(STRIPE_SECRET_KEY="sk_live_example")
    def test_live_key_not_configured(self):
        self.assertFalse(self.api.get("/api/billing/").data["configured"])
