import type { SpeedMultiplier } from '../core/types.ts';
import type { WavePreview } from '../sim/waveSystem.ts';
import { ENEMY_BADGE_META, UI_ICON_SVGS } from './icons.ts';

export interface HudCallbacks {
  onStartWave: () => void;
  onToggleAutoWave: () => void;
  onToggleRoutes: () => void;
  onSetSpeed: (speed: SpeedMultiplier) => void;
  onTogglePause: () => void;
  onOpenSettings: () => void;
  onOpenMenu: () => void;
  onRotateCamera: (dir: -1 | 1) => void;
}

export interface HudStateView {
  gold: number;
  lives: number;
  currentWave: number;
  totalWaves: number;
  speed: SpeedMultiplier;
  paused: boolean;
  canStartWave: boolean;
  isPreFirstWave: boolean;
  earlyBonus: number;
  countdownSec: number;
  nextPreview: WavePreview | null;
  autoWave: boolean;
  routesVisible: boolean;
  isEndless: boolean;
}

export class HudBar {
  private readonly rootEl: HTMLDivElement;
  private readonly goldValEl: HTMLSpanElement;
  private readonly livesValEl: HTMLSpanElement;
  private readonly waveValEl: HTMLSpanElement;
  private readonly waveBtn: HTMLButtonElement;
  private readonly waveBtnTitle: HTMLSpanElement;
  private readonly waveBtnSub: HTMLSpanElement;
  private readonly autoWaveBtn: HTMLButtonElement;
  private readonly routesBtn: HTMLButtonElement;
  private readonly previewEl: HTMLDivElement;
  private readonly speedBtns: Map<SpeedMultiplier, HTMLButtonElement> = new Map();
  private readonly pauseBtn: HTMLButtonElement;

  private lastGold = -1;
  private lastLives = -1;
  private lastWaveBadgeKey = '';
  private lastWaveKey = '';
  private lastPreviewKey = '';

  constructor(parent: HTMLElement, callbacks: HudCallbacks) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'hud-top ui-interactive';

    // Left cluster: Gold, Lives, Wave counter
    const leftGroup = document.createElement('div');
    leftGroup.className = 'hud-group hud-resources';

    const goldPill = document.createElement('div');
    goldPill.className = 'hud-pill hud-gold';
    goldPill.innerHTML = `<span class="hud-icon">${UI_ICON_SVGS.coin}</span>`;
    this.goldValEl = document.createElement('span');
    this.goldValEl.className = 'hud-val';
    goldPill.appendChild(this.goldValEl);

    const livesPill = document.createElement('div');
    livesPill.className = 'hud-pill hud-lives';
    livesPill.innerHTML = `<span class="hud-icon">${UI_ICON_SVGS.heart}</span>`;
    this.livesValEl = document.createElement('span');
    this.livesValEl.className = 'hud-val';
    livesPill.appendChild(this.livesValEl);

    const wavePill = document.createElement('div');
    wavePill.className = 'hud-pill hud-wave-counter';
    wavePill.innerHTML = `<span class="hud-icon">${UI_ICON_SVGS.wave}</span>`;
    this.waveValEl = document.createElement('span');
    this.waveValEl.className = 'hud-val';
    wavePill.appendChild(this.waveValEl);

    leftGroup.append(goldPill, livesPill, wavePill);

    // Center cluster: Start / Next Wave CTA + Auto-Wave & Routes toggles + upcoming wave preview chips
    const centerGroup = document.createElement('div');
    centerGroup.className = 'hud-group hud-wave-ctrl';
    centerGroup.style.flexWrap = 'wrap';

    this.waveBtn = document.createElement('button');
    this.waveBtn.type = 'button';
    this.waveBtn.className = 'hud-wave-btn';
    this.waveBtnTitle = document.createElement('span');
    this.waveBtnTitle.className = 'hud-wave-btn-title';
    this.waveBtnSub = document.createElement('span');
    this.waveBtnSub.className = 'hud-wave-btn-sub';
    this.waveBtn.append(this.waveBtnTitle, this.waveBtnSub);
    this.waveBtn.addEventListener('click', () => callbacks.onStartWave());

    const makeTogglePill = (
      iconSvg: string,
      label: string,
      title: string,
      testId: string,
      onClick: () => void,
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-icon-btn hud-toggle-pill';
      btn.title = title;
      btn.setAttribute('data-testid', testId);
      btn.setAttribute('aria-pressed', 'false');
      btn.style.width = 'auto';
      btn.style.padding = '0 8px';
      btn.style.gap = '4px';
      btn.style.fontSize = '11px';
      btn.style.fontWeight = '800';
      btn.style.whiteSpace = 'nowrap';

      const iconSpan = document.createElement('span');
      iconSpan.className = 'hud-toggle-icon';
      iconSpan.style.width = '14px';
      iconSpan.style.height = '14px';
      iconSpan.style.display = 'inline-flex';
      iconSpan.style.alignItems = 'center';
      iconSpan.style.justifyContent = 'center';
      iconSpan.style.flexShrink = '0';
      iconSpan.innerHTML = iconSvg;

      const labelSpan = document.createElement('span');
      labelSpan.className = 'hud-toggle-label';
      labelSpan.textContent = label;

      btn.append(iconSpan, labelSpan);
      btn.addEventListener('click', onClick);
      return btn;
    };

    this.autoWaveBtn = makeTogglePill(
      UI_ICON_SVGS.autoWave,
      'Auto',
      'Auto-start next waves (X)',
      'btn-hud-autowave',
      () => callbacks.onToggleAutoWave(),
    );

    this.routesBtn = makeTogglePill(
      UI_ICON_SVGS.lanes,
      'Lanes',
      'Toggle ground & sky lane preview (R)',
      'btn-hud-routes',
      () => callbacks.onToggleRoutes(),
    );

    this.previewEl = document.createElement('div');
    this.previewEl.className = 'hud-wave-preview';

    centerGroup.append(this.waveBtn, this.autoWaveBtn, this.routesBtn, this.previewEl);

    // Right cluster: Camera Q/E rotate, Speed 1x/2x/3x, Pause, Settings
    const rightGroup = document.createElement('div');
    rightGroup.className = 'hud-group hud-actions';

    const rotLeftBtn = document.createElement('button');
    rotLeftBtn.type = 'button';
    rotLeftBtn.className = 'hud-icon-btn';
    rotLeftBtn.title = 'Rotate camera left (Q)';
    rotLeftBtn.innerHTML = UI_ICON_SVGS.rotateLeft;
    rotLeftBtn.addEventListener('click', () => callbacks.onRotateCamera(-1));

    const rotRightBtn = document.createElement('button');
    rotRightBtn.type = 'button';
    rotRightBtn.className = 'hud-icon-btn';
    rotRightBtn.title = 'Rotate camera right (E)';
    rotRightBtn.innerHTML = UI_ICON_SVGS.rotateRight;
    rotRightBtn.addEventListener('click', () => callbacks.onRotateCamera(1));

    const speedWrap = document.createElement('div');
    speedWrap.className = 'hud-speed-wrap';
    const speeds: readonly SpeedMultiplier[] = [1, 2, 3];
    for (let i = 0; i < speeds.length; i++) {
      const sp = speeds[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-speed-btn';
      btn.textContent = `${sp}x`;
      btn.addEventListener('click', () => callbacks.onSetSpeed(sp));
      this.speedBtns.set(sp, btn);
      speedWrap.appendChild(btn);
    }

    this.pauseBtn = document.createElement('button');
    this.pauseBtn.type = 'button';
    this.pauseBtn.className = 'hud-icon-btn hud-pause-btn';
    this.pauseBtn.title = 'Pause / Resume (Space)';
    this.pauseBtn.addEventListener('click', () => callbacks.onTogglePause());

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'hud-icon-btn';
    settingsBtn.title = 'Settings';
    settingsBtn.innerHTML = UI_ICON_SVGS.settings;
    settingsBtn.addEventListener('click', () => callbacks.onOpenSettings());

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'hud-icon-btn';
    menuBtn.title = 'Pause Menu (Esc)';
    menuBtn.setAttribute('data-testid', 'btn-hud-menu');
    menuBtn.innerHTML = UI_ICON_SVGS.menu;
    menuBtn.addEventListener('click', () => callbacks.onOpenMenu());

    rightGroup.append(rotLeftBtn, rotRightBtn, speedWrap, this.pauseBtn, settingsBtn, menuBtn);

    this.rootEl.append(leftGroup, centerGroup, rightGroup);
    parent.appendChild(this.rootEl);
  }

  update(view: HudStateView): void {
    if (view.gold !== this.lastGold) {
      this.lastGold = view.gold;
      this.goldValEl.textContent = `${view.gold}g`;
    }

    if (view.lives !== this.lastLives) {
      this.lastLives = view.lives;
      this.livesValEl.textContent = String(view.lives);
    }

    const waveBadgeKey = `${view.currentWave}|${view.totalWaves}|${view.isEndless ? 1 : 0}`;
    if (waveBadgeKey !== this.lastWaveBadgeKey) {
      this.lastWaveBadgeKey = waveBadgeKey;
      this.waveValEl.textContent = view.isEndless
        ? `Wave ${view.currentWave} ∞`
        : `Wave ${view.currentWave}/${view.totalWaves}`;
      this.waveValEl.classList.toggle('is-endless', view.isEndless);
    }

    this.autoWaveBtn.classList.toggle('active', view.autoWave);
    this.autoWaveBtn.setAttribute('aria-pressed', view.autoWave ? 'true' : 'false');
    this.routesBtn.classList.toggle('active', view.routesVisible);
    this.routesBtn.setAttribute('aria-pressed', view.routesVisible ? 'true' : 'false');

    const countdownInt = Math.ceil(view.countdownSec);
    const waveKey = `${view.canStartWave}|${view.isPreFirstWave}|${view.earlyBonus}|${countdownInt}|${view.currentWave}|${view.totalWaves}|${view.isEndless ? 1 : 0}`;
    if (waveKey !== this.lastWaveKey) {
      this.lastWaveKey = waveKey;
      this.waveBtn.disabled = !view.canStartWave;
      this.waveBtn.classList.toggle('ready', view.canStartWave);
      if (view.isPreFirstWave) {
        this.waveBtnTitle.textContent = 'Start Wave 1';
        this.waveBtnSub.textContent = 'Click when ready';
      } else if (view.canStartWave) {
        const nextNum = view.currentWave + 1;
        this.waveBtnTitle.textContent = `Next Wave ${nextNum}`;
        this.waveBtnSub.textContent =
          view.earlyBonus > 0
            ? countdownInt > 0
              ? `Call Early +${view.earlyBonus}g (${countdownInt}s)`
              : `Call Early +${view.earlyBonus}g`
            : 'Send wave now';
      } else if (!view.isEndless && view.currentWave >= view.totalWaves) {
        this.waveBtnTitle.textContent = 'Final Wave';
        this.waveBtnSub.textContent = 'Hold the Skyhold!';
      } else {
        this.waveBtnTitle.textContent = `Wave ${view.currentWave} Active`;
        this.waveBtnSub.textContent = 'Deploying foes...';
      }
    }

    const previewKey = view.nextPreview
      ? `${view.nextPreview.waveOneBased}:${view.nextPreview.items.map((x) => `${x.enemyType}${x.count}`).join(',')}`
      : view.isEndless
        ? 'endless-none'
        : 'none';
    if (previewKey !== this.lastPreviewKey) {
      this.lastPreviewKey = previewKey;
      this.previewEl.innerHTML = '';
      if (view.nextPreview) {
        const lbl = document.createElement('span');
        lbl.className = 'hud-preview-label';
        lbl.textContent = `W${view.nextPreview.waveOneBased}:`;
        this.previewEl.appendChild(lbl);
        for (let i = 0; i < view.nextPreview.items.length; i++) {
          const item = view.nextPreview.items[i];
          const meta = ENEMY_BADGE_META[item.enemyType];
          const chip = document.createElement('span');
          if (item.enemyType === 'flyer' && item.count >= 3) {
            chip.className = 'hud-preview-chip hud-preview-chip-flyer-warn';
            chip.title = 'Aerial threat: only Archer, Frost, and Tesla can hit Flyers';
            chip.innerHTML = `<span class="hud-preview-warn-icon">${UI_ICON_SVGS.flyerAlert}</span><span>${item.count} Flyers incoming</span>`;
          } else {
            chip.className = 'hud-preview-chip';
            chip.innerHTML = `<i style="background:${meta.color}"></i>${item.count}× ${meta.label}`;
          }
          this.previewEl.appendChild(chip);
        }
      } else {
        const lbl = document.createElement('span');
        lbl.className = 'hud-preview-label';
        lbl.textContent = view.isEndless ? 'Endless Surge' : 'Final Wave!';
        this.previewEl.appendChild(lbl);
      }
    }

    this.speedBtns.forEach((btn, sp) => {
      btn.classList.toggle('active', !view.paused && view.speed === sp);
    });
    this.pauseBtn.classList.toggle('active', view.paused);
    this.pauseBtn.innerHTML = view.paused ? UI_ICON_SVGS.play : UI_ICON_SVGS.pause;
  }

  setVisible(visible: boolean): void {
    this.rootEl.classList.toggle('hidden', !visible);
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
