import '../styles/waveBanner.css';
import type { WaveBannerContent } from './waveHints.ts';

const SHOW_MS = 3800;

/**
 * Small non-blocking banner shown when a wave starts: kicker, wave name, one hint line. Never takes pointer
 * input, sits just under the HUD bar, and yields (hides) when a card or the tour needs the space.
 */
export class WaveBanner {
  private readonly rootEl: HTMLDivElement;
  private readonly kickerEl: HTMLSpanElement;
  private readonly eliteEl: HTMLSpanElement;
  private readonly titleEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private timer: number | null = null;

  constructor(parent: HTMLElement) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'wb-banner gx gx-slate hidden';
    this.rootEl.setAttribute('role', 'status');
    this.rootEl.setAttribute('aria-live', 'polite');
    this.rootEl.setAttribute('data-testid', 'wave-banner');

    const head = document.createElement('div');
    head.className = 'wb-head';
    this.kickerEl = document.createElement('span');
    this.kickerEl.className = 'wb-kicker';
    this.eliteEl = document.createElement('span');
    this.eliteEl.className = 'wb-elite';
    this.eliteEl.textContent = 'Elites';
    head.append(this.kickerEl, this.eliteEl);

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'wb-title';
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'wb-hint';
    this.rootEl.append(head, this.titleEl, this.hintEl);
    parent.appendChild(this.rootEl);
  }

  isVisible(): boolean {
    return !this.rootEl.classList.contains('hidden');
  }

  show(content: WaveBannerContent): void {
    this.clearTimer();
    this.kickerEl.textContent = content.kicker;
    this.eliteEl.classList.toggle('hidden', !content.elite);
    this.titleEl.textContent = content.title;
    this.hintEl.textContent = content.hint;
    this.rootEl.dataset.accent = content.accent;
    this.placeBelowHud();
    // Restart the CSS animation when a new wave replaces a banner that is still up.
    this.rootEl.classList.add('hidden');
    void this.rootEl.offsetWidth;
    this.rootEl.classList.remove('hidden');
    this.timer = window.setTimeout(() => this.hide(), SHOW_MS);
  }

  hide(): void {
    this.clearTimer();
    this.rootEl.classList.add('hidden');
  }

  /** Sit just under the lowest HUD control so the banner never covers the wave button / preview strip. */
  private placeBelowHud(): void {
    let bottom = 0;
    const els = document.querySelectorAll<HTMLElement>('.hud-top .gx, .hud-top button');
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (r.height < 8 || r.width < 8) continue;
      if (r.bottom > bottom && r.bottom < window.innerHeight * 0.4) bottom = r.bottom;
    }
    this.rootEl.style.top = bottom > 0 ? `${Math.round(bottom + 8)}px` : '';
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.clearTimer();
    this.rootEl.remove();
  }
}
