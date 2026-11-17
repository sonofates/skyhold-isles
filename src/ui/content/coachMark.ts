import '../styles/onboarding.css';
import type { CoachMessage, CoachTarget } from './onboardingMachine.ts';

const SPOT_SELECTORS: Record<Exclude<CoachTarget, 'none'>, string> = {
  buildBar: '.build-bar .build-card[data-tower="archer"]',
  ring: '.radial-root:not(.hidden) [data-tower="archer"]',
  waveBtn: '.hud-wave-btn',
  towerUi: '.radial-root:not(.hidden) [data-action="upgrade"], .tower-panel:not(.hidden) .tower-upgrade-btn',
  meteor: '.ability-bar .ability-card[data-ability="meteor"]',
};

/** The small guide card shown during the first-run tour, plus the glow on the control it refers to. */
export class CoachMark {
  private readonly rootEl: HTMLDivElement;
  private readonly badgeEl: HTMLSpanElement;
  private readonly titleEl: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly markerEl: HTMLDivElement;
  private spotEl: Element | null = null;
  private target: CoachTarget = 'none';
  private lastKey = '';

  constructor(parent: HTMLElement, onSkip: () => void) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'onb-coach gx gx-slate hidden';
    this.rootEl.setAttribute('role', 'status');
    this.rootEl.setAttribute('aria-live', 'polite');
    this.rootEl.setAttribute('data-testid', 'onboarding-coach');

    this.badgeEl = document.createElement('span');
    this.badgeEl.className = 'onb-coach-badge';

    const body = document.createElement('div');
    body.className = 'onb-coach-body';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'onb-coach-title';
    this.textEl = document.createElement('div');
    this.textEl.className = 'onb-coach-text';
    body.append(this.titleEl, this.textEl);

    this.skipBtn = document.createElement('button');
    this.skipBtn.type = 'button';
    this.skipBtn.className = 'onb-coach-skip ui-interactive';
    this.skipBtn.textContent = 'Skip tour';
    this.skipBtn.setAttribute('data-testid', 'onboarding-skip');
    this.skipBtn.addEventListener('click', onSkip);

    this.rootEl.append(this.badgeEl, body, this.skipBtn);
    parent.appendChild(this.rootEl);

    // Bobbing "build here" arrow, positioned in screen space by the director every frame.
    this.markerEl = document.createElement('div');
    this.markerEl.className = 'onb-marker hidden';
    this.markerEl.setAttribute('aria-hidden', 'true');
    this.markerEl.innerHTML =
      '<span class="onb-marker-ring"></span><svg class="onb-marker-arrow" viewBox="0 0 24 24"><path d="M12 21 3.5 9.5h5.2V3h6.6v6.5h5.2z" fill="#f6bd41" stroke="#1b1936" stroke-width="2" stroke-linejoin="round"/></svg>';
    parent.appendChild(this.markerEl);
  }

  show(msg: CoachMessage): void {
    const key = `${msg.index}|${msg.title}|${msg.text}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.badgeEl.textContent = `${msg.index}/${msg.total}`;
      this.titleEl.textContent = msg.title;
      this.textEl.textContent = msg.text;
    }
    this.target = msg.target;
    this.rootEl.classList.remove('hidden');
    this.refreshSpot();
  }

  /** Re-applies the glow (the radial ring rebuilds its tokens, which drops the class). */
  refreshSpot(): void {
    const sel = this.target === 'none' ? null : SPOT_SELECTORS[this.target];
    const next = sel ? this.rootEl.ownerDocument.querySelector(sel) : null;
    if (next === this.spotEl) {
      if (next && !next.classList.contains('onb-spot')) next.classList.add('onb-spot');
      return;
    }
    this.spotEl?.classList.remove('onb-spot');
    this.spotEl = next;
    next?.classList.add('onb-spot');
  }

  /** Place the marker at a screen position (CSS px), or hide it with null. */
  setMarker(pos: { x: number; y: number } | null): void {
    if (!pos) {
      this.markerEl.classList.add('hidden');
      return;
    }
    this.markerEl.classList.remove('hidden');
    this.markerEl.style.transform = `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`;
  }

  hide(): void {
    this.setMarker(null);
    this.lastKey = '';
    this.target = 'none';
    this.spotEl?.classList.remove('onb-spot');
    this.spotEl = null;
    this.rootEl.classList.add('hidden');
  }

  /** Brief closing message after the last step. */
  showDone(): void {
    this.lastKey = 'done';
    this.badgeEl.textContent = '✓';
    this.titleEl.textContent = 'You’re ready!';
    this.textEl.textContent = 'Hold the island, protect the crystal — and check the Codex any time for foe tips.';
    this.rootEl.classList.add('is-done');
    this.skipBtn.textContent = 'Close';
    this.target = 'none';
    this.spotEl?.classList.remove('onb-spot');
    this.spotEl = null;
    this.rootEl.classList.remove('hidden');
  }

  resetDoneStyle(): void {
    this.rootEl.classList.remove('is-done');
    this.skipBtn.textContent = 'Skip tour';
  }

  dispose(): void {
    this.hide();
    this.rootEl.remove();
    this.markerEl.remove();
  }
}
