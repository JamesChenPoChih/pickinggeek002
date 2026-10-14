# Google Report Translation

The report translation button uses Google Cloud Translation Basic (v2), not
Nebius. Analysis generation still uses the existing Pro/Ultra models.

1. Enable Cloud Translation API in your Google Cloud project with billing enabled.
2. Create an API key restricted to Cloud Translation API. Set an appropriate quota
   and billing alerts. Restrict backend IP addresses when stable outbound IPs are available.
3. Set `GOOGLE_TRANSLATE_API_KEY` in the local `.env` and Render environment.
   Do not use a `VITE_` prefix or commit the key. Google OAuth client IDs are unrelated.
4. Restart Django locally and redeploy on Render.

Reports are sent to Google for translation. All sections are sent in one request,
with a 20-second timeout and no automatic retries. Missing credentials do not
fall back to Nebius. Errors preserve the original report.

Chinese targets `zh-TW` and is normalized with OpenCC. Successful translations
are cached for one hour per user, report and target language. Frontend history
also caches translated reports; returning to the original requires no API call.

Official documentation: https://cloud.google.com/translate/docs/basic/translating-text
Pricing: https://cloud.google.com/translate/pricing
