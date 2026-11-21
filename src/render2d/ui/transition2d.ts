/**
 * Screen transitions between pages (world map ↔ battle): before navigating, a veil in the boot
 * screen's colours fades in (2d.html `#boot` has the same sea gradient and gold ring), so leaving
 * the map, the new page's boot screen and the battle fading in read as one move. The boot screen
 * fades out once the page is ready (`dismissBoot`). Reduced motion: no fades, straight cuts.
 */

const VEIL_MS = 260;
const BOOT_FADE_MS = 150;

function reduced(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('pu-reduce-motion');
}

/** Starts the veil while navigating to `href` (once; a second call while leaving is ignored). */
export function navigateWithVeil(href: string, replace = false): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('pu-veil')) return;
  const go = (): void => {
    if (replace) location.replace(href);
    else location.assign(href);
  };
  if (reduced()) {
    go();
    return;
  }
  const veil = document.createElement('div');
  veil.id = 'pu-veil';
  veil.className = 'boot-look';
  veil.setAttribute('aria-hidden', 'true');
  veil.append(Object.assign(document.createElement('i'), { className: 'boot-ring' }));
  veil.style.opacity = '0';
  veil.style.transition = `opacity ${VEIL_MS}ms ease`; // i18n-ignore (CSS)
  document.body.append(veil);
  // Back / forward cache: the page comes back as it was left — without the veil.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) veil.remove();
  });
  requestAnimationFrame(() => {
    veil.style.opacity = '1';
  });
  go();
}

/** The boot screen fades out (then leaves the DOM); at once with reduced motion. */
export function dismissBoot(): void {
  const boot = typeof document !== 'undefined' ? document.getElementById('boot') : null;
  if (!boot) return;
  // QA and the game look for `#boot` being gone: rename it at once, fade the old node.
  boot.id = 'boot-leaving';
  if (reduced()) {
    boot.remove();
    return;
  }
  boot.style.transition = `opacity ${BOOT_FADE_MS}ms ease`; // i18n-ignore (CSS)
  boot.style.pointerEvents = 'none';
  requestAnimationFrame(() => {
    boot.style.opacity = '0';
  });
  window.setTimeout(() => boot.remove(), BOOT_FADE_MS + 60);
}

/** The boot line's text node (the ring stays). */
export function setBootText(text: string): void {
  const boot = typeof document !== 'undefined' ? document.getElementById('boot') : null;
  if (!boot) return;
  const line = boot.querySelector('.boot-text');
  if (line) line.textContent = text;
  else boot.textContent = text;
}

/** Battle-only progress reflects finished asset jobs, the rendered scene and installed controls. */
export function setBootProgress(fraction: number): void {
  const bar = document.getElementById('boot')?.querySelector('progress');
  if (bar) {
    bar.hidden = false;
    bar.value = fraction;
  }
}

export function setBootArtwork(url: string | null): void {
  const boot = document.getElementById('boot');
  if (boot && url) boot.style.setProperty('--island-art', `url(${JSON.stringify(url)})`);
}

/** A "Tip" card under the boot line while a battle loads (label + one sentence). */
export function setBootTip(label: string, text: string): void {
  const boot = typeof document !== 'undefined' ? document.getElementById('boot') : null;
  if (!boot) return;
  let tip = boot.querySelector('.boot-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'boot-tip';
    boot.append(tip);
  }
  const head = document.createElement('b');
  head.textContent = label;
  const line = document.createElement('span');
  line.textContent = text;
  tip.replaceChildren(head, line);
}

/** Loading tips, one picked per battle load (`r` in 0..1). */
export const LOAD_TIPS = [
  'loadtip.1',
  'loadtip.2',
  'loadtip.3',
  'loadtip.4',
  'loadtip.5',
  'loadtip.6',
  'loadtip.7',
  'loadtip.8',
  'loadtip.9',
  'loadtip.10',
  'loadtip.11',
  'loadtip.12',
  'loadtip.13',
] as const;

export function pickLoadTip(r: number): (typeof LOAD_TIPS)[number] {
  return LOAD_TIPS[Math.min(LOAD_TIPS.length - 1, Math.max(0, Math.floor(r * LOAD_TIPS.length)))];
}
