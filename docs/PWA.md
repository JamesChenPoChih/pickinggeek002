# Picking Geek PWA

The React app can be installed as a standalone web app. This does not publish it
to the App Store or Google Play, and does not add push notifications.

## Installation

- Desktop Chrome/Edge: use the browser installation option, or the install action
  in Me when the browser fires `beforeinstallprompt`.
- Android Chrome: install from the browser menu or the Me action.
- iPhone/iPad: use the browser Share menu and Add to Home Screen. The custom
  Chromium installation prompt is not available on iOS.
- HTTPS is required in production. Localhost/127.0.0.1 can be used for testing.
- Render must deploy this code before its site gains these features.

## Build and hosting

Run `npm run build` from `frontend`, then deploy Django normally. Vite copies
`frontend/public` into `backend/frontend_dist/frontend`. Django serves the root
manifest, worker, offline page and whitelisted icons before the SPA catch-all:

- `/manifest.webmanifest`
- `/sw.js` (scope `/`, no-cache, correct JavaScript MIME type)
- `/offline.html`
- `/pwa-icons/<approved-name>.png`

Keep these root routes: the production JavaScript asset base is
`/static/frontend/`, but the service worker must control the application root.

## Privacy and offline behavior

The worker caches only a fixed list of public PNG icons and the offline page.
It never caches the application HTML, JavaScript, API responses, quotes, tokens,
admin pages or payment results. Offline navigation shows an unavailable message,
not stale prices. Login, charts, payments and AI require a network connection.
Cached samples/documents in Neon are unrelated to the browser's PWA cache.

## Updates

Application navigation and assets continue to use normal network loading. A new
service worker waits until existing windows close or the user selects Update app
in Me. This explicit action activates the worker and reloads the current window;
it does not automatically reload during a checkout or analysis.

For changes to cached public resources, also update the offline cache revision in
`frontend/public/sw.js`, then rebuild. Activation removes only obsolete caches
whose names begin with `pickinggeek-pwa-offline-`.
