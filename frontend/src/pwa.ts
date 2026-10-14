export interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export let installPrompt: InstallPrompt | null = null;
export let pwaRegistration: ServiceWorkerRegistration | null = null;
const changed = () => window.dispatchEvent(new Event('pickinggeek:pwa'));

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event as InstallPrompt;
  changed();
});
window.addEventListener('appinstalled', () => { installPrompt = null; changed(); });

export async function installApp() {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = null;
  changed();
  await prompt.prompt();
  await prompt.userChoice;
}

export function registerPwa() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(registration => {
      pwaRegistration = registration;
      changed();
      registration.addEventListener('updatefound', () => {
        registration.installing?.addEventListener('statechange', changed);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => undefined);
      });
    }).catch(() => undefined);
  }, { once: true });
}

export function applyPwaUpdate() {
  if (!pwaRegistration?.waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  pwaRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
}
