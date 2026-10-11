"""Sandbox subscriptions. Never grant entitlements from browser return parameters."""
import uuid
from functools import wraps
from urllib.parse import urlparse

import stripe
from django.conf import settings
from django.db import transaction
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import BillingAccount, User


def configured():
    return bool(settings.STRIPE_SECRET_KEY.startswith("sk_test_")
                and settings.STRIPE_WEBHOOK_SECRET
                and settings.STRIPE_PRO_PRICE_ID
                and settings.STRIPE_PREMIUM_PRICE_ID
                and settings.STRIPE_PRO_PRICE_ID != settings.STRIPE_PREMIUM_PRICE_ID)


def client():
    if not configured():
        raise ValueError("Stripe sandbox is not configured. Please contact the administrator.")
    return stripe.StripeClient(settings.STRIPE_SECRET_KEY, max_network_retries=2).v1


def billing_errors(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        try:
            return view(*args, **kwargs)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        except stripe.StripeError:
            return Response({"detail": "Stripe is unavailable or its sandbox configuration is invalid. Please retry."}, status=502)
    return wrapped


def plans():
    return {"PRO": (settings.STRIPE_PRO_PRICE_ID, 999),
            "PREMIUM": (settings.STRIPE_PREMIUM_PRICE_ID, 3999)}


def price_tier(price):
    for tier, (price_id, amount) in plans().items():
        recurring = price.get("recurring") or {}
        if (price.get("id") == price_id and not price.get("livemode", True)
                and price.get("currency") == "usd" and price.get("unit_amount") == amount
                and recurring.get("interval") == "month" and recurring.get("interval_count") == 1):
            return tier
    return None


def return_url():
    url = settings.BILLING_FRONTEND_URL
    parsed = urlparse(url)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
        raise ValueError("BILLING_FRONTEND_URL must use HTTPS (except localhost).")
    return url + "/?billing=return"


def synchronize(account, api):
    if not account.customer_id:
        return
    # Retrieve canonical state under the account lock: duplicate/late events converge.
    subscriptions = list(api.subscriptions.list({"customer": account.customer_id, "status": "all", "limit": 100}).auto_paging_iter())
    managed = []
    for sub in subscriptions:
        if sub.get("livemode", True):
            raise ValueError("Live subscriptions are not supported by this sandbox integration.")
        items = sub["items"]["data"]
        tier = price_tier(items[0]["price"]) if len(items) == 1 and items[0].get("quantity") == 1 else None
        if tier:
            managed.append((sub, tier))
    active = [(s, t) for s, t in managed if s["status"] in ("active", "trialing")]
    selected = max(active or managed, key=lambda pair: ((pair[1] == "PREMIUM") if active else False, pair[0]["created"]), default=None)
    if selected:
        sub, tier = selected
        account.subscription_id = sub["id"]
        account.status = sub["status"]
        account.cancel_at_period_end = sub.get("cancel_at_period_end", False)
        account.period_end = sub["items"]["data"][0].get("current_period_end", sub.get("current_period_end"))
        if account.checkout_id:
            session = api.checkout.sessions.retrieve(account.checkout_id)
            if session.status == "complete":
                account.checkout_id = ""
                account.checkout_key = uuid.uuid4()
        User.objects.filter(pk=account.user_id).update(tier=tier if active else User.Tier.FREE)
    elif account.subscription_id:
        account.status = "canceled"
        User.objects.filter(pk=account.user_id).update(tier=User.Tier.FREE)
    account.save()


def locked_account(user):
    User.objects.select_for_update().get(pk=user.pk)
    account, _ = BillingAccount.objects.get_or_create(user=user)
    return BillingAccount.objects.select_for_update().get(pk=account.pk)


@api_view(["GET", "POST"])
@billing_errors
def billing_state(request):
    with transaction.atomic():
        account = locked_account(request.user)
        if request.method == "POST" and account.customer_id:
            synchronize(account, client())
        request.user.refresh_from_db()
        user = request.user
        return Response({"configured": configured(), "sandbox": True,
                         "user": {"name": user.get_full_name() or user.username, "email": user.email,
                                  "avatar": user.avatar_url, "tier": user.tier},
                         "status": account.status, "has_customer": bool(account.customer_id),
                         "has_subscription": bool(account.subscription_id),
                         "cancel_at_period_end": account.cancel_at_period_end, "period_end": account.period_end})


@api_view(["POST"])
@billing_errors
def checkout(request):
    tier = request.data.get("tier")
    if tier not in plans():
        return Response({"detail": "Choose PRO or PREMIUM. Basic is free; cancel paid subscriptions in billing management."}, status=400)
    api = client()
    with transaction.atomic():
        account = locked_account(request.user)
        if not account.customer_id:
            customer = api.customers.create({"email": request.user.email, "metadata": {"user_id": str(request.user.pk)}},
                                            options={"idempotency_key": f"customer-{account.pk}-{account.checkout_key}"})
            account.customer_id = customer.id
            account.save()
        synchronize(account, api)
        existing = api.subscriptions.list({"customer": account.customer_id, "status": "all", "limit": 100})
        if any(s["status"] not in ("canceled", "incomplete_expired") for s in existing.auto_paging_iter()):
            return Response({"detail": "An existing subscription must be managed in Stripe billing management."}, status=409)
        price = api.prices.retrieve(plans()[tier][0])
        if price_tier(price) != tier or not price.get("active"):
            raise ValueError("The sandbox Price must match the advertised USD monthly amount.")
        if account.checkout_id:
            session = api.checkout.sessions.retrieve(account.checkout_id)
            if session.status == "open":
                if session.metadata.get("tier") == tier:
                    return Response({"url": session.url})
                api.checkout.sessions.expire(session.id)
            elif session.status == "complete":
                return Response({"detail": "Checkout is complete. Refresh subscription status before trying again."}, status=409)
            account.checkout_key = uuid.uuid4()
        session = api.checkout.sessions.create({
            "mode": "subscription", "customer": account.customer_id,
            "line_items": [{"price": price.id, "quantity": 1}],
            "payment_method_types": ["card"], "metadata": {"tier": tier},
            "success_url": return_url(), "cancel_url": settings.BILLING_FRONTEND_URL + "/?billing=cancel",
        }, options={"idempotency_key": f"checkout-{account.pk}-{account.checkout_key}-{tier}"})
        account.checkout_id = session.id
        account.save()
        return Response({"url": session.url})


@api_view(["POST"])
@billing_errors
def portal(request):
    api = client()
    account = BillingAccount.objects.filter(user=request.user).first()
    if not account or not account.customer_id:
        return Response({"detail": "No Stripe billing account yet."}, status=400)
    session = api.billing_portal.sessions.create({"customer": account.customer_id, "return_url": return_url()})
    return Response({"url": session.url})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@billing_errors
def webhook(request):
    if not configured():
        return Response(status=503)
    try:
        event = stripe.Webhook.construct_event(request.body, request.headers.get("Stripe-Signature", ""), settings.STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError):
        return Response(status=400)
    if event.get("livemode", True):
        return Response(status=400)
    if event["type"].startswith(("customer.subscription.", "checkout.session.", "invoice.")):
        customer = event["data"]["object"].get("customer")
        with transaction.atomic():
            reference = BillingAccount.objects.filter(customer_id=customer).first() if customer else None
            if reference:
                account = locked_account(reference.user)
                synchronize(account, client())
    return Response({"received": True})
