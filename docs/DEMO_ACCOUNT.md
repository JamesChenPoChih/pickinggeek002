# Demo Account Policy

Designated demonstration users have a `DemoAccount` record. They receive Pro watchlist membership but no staff, superuser, group, or explicit user permissions during provisioning. Existing administrator, Google-linked, and Stripe-linked identities are not overwritten.

The designated hosted account is `DemoGuest`; the separate existing `demo` administrator is not modified. Its password is provisioned privately, stored only as a Django password hash, and is not included in this file.

| Mode | Daily accepted requests |
| --- | --- |
| Pro (`quick`) | 20 |
| Ultra (`deep`) | 3 |

Counters are shared by everyone using that account and persisted in PostgreSQL. The date rolls over at midnight in the backend `TIME_ZONE` (`Asia/Taipei` by default). A single conditional SQL update reserves a slot and resets both counters when needed; database constraints enforce the counter bounds. Concurrent requests cannot both consume the final slot. `auto` mode consumes the quota of the actual routed model.

Valid accepted analysis submissions consume one request, including provider failures and cancellation after acceptance. Invalid inputs, unwatched stocks, short-term rate-limit rejections, and daily-quota rejections do not consume daily slots. Accepted-request accounting is deliberate to bound paid retries. Replaying a stored analysis does not invoke the API and does not consume a slot. Translation retains its separate existing behavior and does not consume these analysis quotas.

Exhausted requests receive HTTP 429 with code `daily_demo_limit`, a localized explanation, and the account's usage information before market retrieval or inference begins. `GET /api/ai/usage/` returns only the authenticated account's counters and reset time. Other accounts return `limited: false`; these changes do not introduce paid-plan model entitlements or a global budget for everyone.

The frontend shows remaining Pro and Ultra requests for designated demo accounts. Existing per-minute throttling still applies in addition to daily quotas. Provisioning the account again does not reset its counters.

Deployment requires migration `0008_demo_account` and the updated backend. Creating the database record alone does not make an older Render deployment enforce this policy. Restart/update the application after deployment. The account is not an administrator and cannot access Django admin, even if the public demo password is known.
