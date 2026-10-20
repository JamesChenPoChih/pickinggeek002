# Stock Alerts

My Stock has a per-stock Set Alert action. Each user has one independently saved
configuration per tracked stock. Multiple selected conditions are combined with
OR; all hits for one completed bar are combined into one in-app notification.

Free (Basic) members can track unlimited stocks and enable alerts for up to five
stocks at a time. The API reports the account's limit to the alert settings UI.
Paid plans retain their existing three-stock alert limit.

The Enable stock alerts control is a white/dark-gray switch. New configurations
start disabled and may be saved with an empty rule list. Enabling requires at
least one valid condition. Disabling preserves selected rules for later use and
dims the stock's bell in My List.

## Timeframe and interpretation

All rules use completed daily candles, independent of the short intraday ranges
in the technical chart. The worker excludes the current forming bar during PRE,
REGULAR and OPEN_24H market states. The first successful evaluation after saving
records a baseline without replaying historical signals. Missing indicator or
volume data does not fabricate a hit. Later checks process the latest completed
bar, not a historical backfill of every session missed during downtime.

- Price/MA and MA/MA rules fire on crossings, not continuously above/below.
- Alignment fires when 5/20/60/200 enters the selected strict ordering.
- Signed bias crosses the configured percentage of MA20 or MA60.
- MACD uses DIF/DEA difference and zero-axis signs, not plot colors.
- A 3-day histogram trend means three consecutive changes (four values) and fires
  when that run starts, rather than every day of a longer run.
- Bollinger middle-band retest means the prior close is above the prior middle,
  then current low touches the middle while the close remains at/above it.
- Expansion requires bandwidth growth versus the prior bar, a crossing of an outer
  band, and volume relative to the preceding 20-bar average.
- Squeeze release means ON to OFF. Momentum strengthening means a sign flip into
  the selected direction or a reversal from non-strengthening into strengthening;
  it is based on values, not shallow/deep color names.
- Divergence is not implemented: pivot/lookback definitions must be specified
  before adding a price/indicator divergence rule.

## Frequency and privacy

ONCE disables the whole stock alert after its first notification. DAILY keeps it
enabled and permits at most one notification per market-local bar date. The worker
locks each alert during evaluation and writes the notification plus frequency
state atomically. Stock/alert access is restricted to the authenticated owner's
watchlist. Notification list and mark-read operations are also owner-scoped.

`NotificationQueue.read_at` is used only for in-app read status; `is_sent` retains
its existing external-delivery meaning. No email, SMS, Web Push or Nebius calls
are made by this feature.

## Local operation (project root)

```powershell
.\.venv\Scripts\python.exe backend/manage.py migrate
.\.venv\Scripts\python.exe backend/manage.py runserver 127.0.0.1:8000
```

While the APP is visible, it checks notifications every 15 seconds and requests
an owner-scoped evaluation. The backend allows one evaluation pass per user per
60 seconds, with at most eight stocks per pass and four concurrent market-data
fetches. Larger lists rotate across passes. Saving settings resets this cooldown.
No separate worker is required for foreground-only use.

For evaluation when no APP page is open, run the worker in a second terminal:

```powershell
.\.venv\Scripts\python.exe backend/manage.py evaluate_alerts --loop --interval 60
```

For an external scheduled job, use `evaluate_alerts` without `--loop`.

## Render operation

The updated render.yaml uses `python backend/start_services.py` after migrations.
This supervisor starts Gunicorn plus one alert worker, restarts a failed worker,
and stops both children on shutdown. An existing service not managed by a Blueprint
must have its Start Command updated manually to match render.yaml.

The worker checks every 60 seconds after the previous pass finishes, with shared
Yahoo chart caching. The in-app bell checks for new notifications every 15 seconds
while the browser is visible. There is no guaranteed real-time delivery SLA.

New notifications received while the APP is open show a dismissible in-app toast.
The bell changes color for today's unread stock alerts, using the browser's
timezone. Older unread items retain their unread badge but do not make the bell
indicate a new alert today. Marking all notifications read clears the highlight.
Summaries include configured MA periods, direction, Bollinger thresholds and
the relevant indicator values captured at trigger time.

The current Render free web service can sleep or be stopped; its worker sleeps
with it. For continuous unattended alerts, use an always-on service or an external
scheduler. This implementation does not keep a free service awake or create a
paid service automatically.

## API

- GET/PUT `/api/stocks/<stock_id>/alert/`: load/save settings.
- POST `/api/alerts/check/`: evaluate the authenticated user's active alerts,
  subject to cooldown, batch limits and an additional 12-request/minute throttle.
- GET `/api/notifications/?timezone=Asia/Taipei`: latest 50 items, total unread
  count and today's unread stock-alert count (`today_unread`).
- POST `/api/notifications/`: mark this user's notifications read.
