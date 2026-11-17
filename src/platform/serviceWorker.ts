/**
 * Registers the offline-cache service worker (production builds only) and reports when a new
 * version is waiting. Updating is player-driven: `apply()` tells the waiting worker to take over,
 * and the page reloads once the new worker controls it.
 */
export interface UpdateHandle {
  /** Activate the waiting worker; the page reloads when it is in control. */
  apply: () => void;
}

export interface ServiceWorkerOptions {
  onUpdateReady: (handle: UpdateHandle) => void;
  /** Minutes between background update checks while the page stays open. */
  checkEveryMin?: number;
}

export function registerServiceWorker(opts: ServiceWorkerOptions): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;

  let reloading = false;
  let applying = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The very first install also claims the page; only reload after the player asked for an update.
    if (!applying || reloading) return;
    reloading = true;
    window.location.reload();
  });

  const announce = (worker: ServiceWorker): void => {
    opts.onUpdateReady({
      apply: () => {
        applying = true;
        worker.postMessage({ type: 'SKIP_WAITING' });
      },
    });
  };

  const start = (): void => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            if (next.state === 'installed' && navigator.serviceWorker.controller) announce(next);
          });
        });
        const check = (): void => {
          reg.update().catch(() => undefined);
        };
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) check();
        });
        window.setInterval(check, (opts.checkEveryMin ?? 30) * 60_000);
      })
      .catch(() => undefined);
  };

  // Never compete with the first paint / asset preload.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
