# Stripe Sandbox Setup

This integration accepts sandbox `sk_test_` keys only. No real money is charged.
Basic is the internal FREE tier and needs no Stripe product.

## Dashboard

1. Open a Stripe sandbox. Create two recurring, fixed-price products:
   - Picking Geek Pro: USD 9.99, monthly (999 cents).
   - Picking Geek Premium: USD 39.99, monthly (3999 cents).
2. Copy their `price_...` IDs (not product IDs) into the environment below.
3. Enable the customer portal in this same sandbox. Enable invoices, payment
   method updates, and cancellation at the end of the billing period.
4. Enable subscription updates with these two products/prices only, quantity 1.
   Configure prorations deliberately; Stripe will show any adjustment at confirmation.
   Do not enable coupons, trials, adjustable quantity, or other products for this app.

## Environment

Add to the project `.env` (never commit credentials):

```dotenv
STRIPE_SECRET_KEY=sk_test_REPLACE
STRIPE_PRO_PRICE_ID=price_REPLACE_PRO
STRIPE_PREMIUM_PRICE_ID=price_REPLACE_PREMIUM
STRIPE_WEBHOOK_SECRET=whsec_REPLACE
BILLING_FRONTEND_URL=http://127.0.0.1:5174
```

Hosted Checkout does not require a frontend publishable key. Secret keys must
never be prefixed with `VITE_` or sent to the browser.

## Local Webhooks

Install and sign into the official Stripe CLI, using the same sandbox as the keys:

```powershell
stripe login
stripe listen --forward-to http://127.0.0.1:8000/api/billing/webhook/
```

Put the listener's signing secret in `STRIPE_WEBHOOK_SECRET`. Keep the listener
running; restart Django after changing `.env`.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe backend/manage.py migrate
.\.venv\Scripts\python.exe backend/manage.py runserver 127.0.0.1:8000
```

## Render

Set all four Stripe variables in Render's environment (the Blueprint lists them
but does not supply values). Use `BILLING_FRONTEND_URL=https://pickinggeek002.onrender.com`.
In Stripe sandbox, register the HTTPS webhook destination:

`https://pickinggeek002.onrender.com/api/billing/webhook/`

Subscribe to `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`invoice.paid`, and `invoice.payment_failed`.
Use this destination's signing secret on Render, NOT the local CLI signing secret.
Deploy code and migrations before enabling checkout for users.

## Test Flow

1. Sign in, open Me > Plan & Subscription, choose Pro or Premium.
2. Stripe Checkout: use test card `4242 4242 4242 4242`, a future expiration date,
   and any three-digit CVC. Never use a real card for sandbox testing.
3. After returning, the app retrieves the subscription from Stripe and updates
   the authenticated user's tier. Refresh subscription to retry after a delay.
4. Open Manage subscription & invoices for invoices, plan changes, or cancellation.
5. Confirm a scheduled cancellation retains access until expiration. Confirm
   canceled/unpaid/past_due subscriptions lose paid access, and repeated checkout
   clicks do not create additional subscriptions. Use Stripe test clocks to test renewals.

## Entitlement Policy

- Active/trialing recognized subscriptions grant the corresponding tier. No trial
  is created by this app. Past_due, unpaid, paused, incomplete and canceled do not grant access.
- Both Pro and Premium currently allow unlimited stock tracking. Premium-specific
  AI quotas/features have not been defined; the app does not promise priority AI.
- Manual tiers are preserved for accounts that have never had a managed subscription.
  Once subscribed, Stripe becomes authoritative for that account's paid tier.
- Downgrading does not delete existing tracked stocks; the existing Basic add-stock
  limit applies. No card data is stored in Neon, only billing IDs/state.
- Webhooks verify Stripe signatures and retrieve current state under a DB lock;
  duplicate or out-of-order events cannot restore stale entitlements.
- Checkout creates only server-selected prices and verifies currency, amount,
  monthly interval, quantity, and test mode. Browser return parameters grant nothing.

## Verification

```powershell
$env:DATABASE_URL='sqlite:///:memory:'
.\.venv\Scripts\python.exe backend/manage.py test pickinggeek --noinput
```

Tests use an isolated SQLite test database and mocked Stripe, not Neon or real cards.
An actual end-to-end sandbox payment still requires configured keys, prices,
portal, and a webhook listener/destination.

Official references:
- https://docs.stripe.com/billing/subscriptions/build-subscriptions
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/customer-management
- https://docs.stripe.com/testing
