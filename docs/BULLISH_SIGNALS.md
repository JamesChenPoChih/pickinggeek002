# Bullish Stock Summary

AI Invest counts stocks, not indicator votes or positive daily price changes.
Use the most recent completed daily bar from the shared technical snapshot engine.
All four indicators must have sufficient finite data. At least three votes qualify:

- MA: close > MA20 > MA60 > MA200.
- MACD: DIF > 0, DIF > DEA, and histogram > 0.
- Bollinger Bands: close > SMA20 middle band (including upper-band breakouts).
- Squeeze: BB is outside KC (OFF), momentum > 0, and momentum > previous bar.

These are screening rules, not a calibrated prediction or a guaranteed buy signal.
ON alone is not a bullish signal. Missing MA200 or prior momentum excludes the stock
from the count. The tooltip lists qualifying symbols, native names, dates, scores and
positive indicator names. No chart/quote/indicator fallback values are invented.

GET /api/stocks/bullish-summary/ requires login and returns only the current user's
active watched stocks. Price charts use the existing shared per-process 15-minute daily
cache. The frontend refreshes the summary every minute while visible, with no overlapping
requests, and cancels on unmount. The summary does not call Nebius or create database rows.
Cold chart retrieval uses at most four simultaneous provider calls. Inactive tabs pause
polling. On failure, a previous successful count remains explicitly marked as stale;
without a successful response, display -- rather than zero.
