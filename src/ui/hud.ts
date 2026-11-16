import type { SpeedMultiplier } from '../core/types.ts';
import type { WavePreview } from '../sim/waveSystem.ts';
import { ENEMY_BADGE_META, ENEMY_ICON_SVGS, UI_ICON_SVGS } from './icons.ts';

export interface HudCallbacks {
  onStartWave: () => void;
  onToggleAutoWave: () => void;
  onToggleRoutes: () => void;
  onSetSpeed: (speed: SpeedMultiplier) => void;
  onTogglePause: () => void;
  onOpenSettings: () => void;
  onOpenMenu: () => void;
  onRotateCamera: (dir: -1 | 1) => void;
  /** Tap on the wave-preview strip: receives a short "10x Grunt, 6x Runner" summary. */
  onPreviewTap?: (summary: string) => void;
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

const SPEED_CYCLE: Record<SpeedMultiplier, SpeedMultiplier> = { 1: 2, 2: 3, 3: 1 };

export class HudBar {
  private readonly rootEl: HTMLDivElement;
  private readonly goldValEl: HTMLSpanElement;
  private readonly livesValEl: HTMLSpanElement;
  private readonly waveValEl: HTMLSpanElement;
  private readonly waveBtn: HTMLButtonElement;
  private readonly waveBtnTitle: HTMLSpanElement;
  private readonly waveBtnSub: HTMLSpanElement;
  private readonly waveBtnShort: HTMLSpanElement;
  private readonly waveBtnBonus: HTMLSpanElement;
  private readonly autoWaveBtn: HTMLButtonElement;
  private readonly routesBtn: HTMLButtonElement;
  private readonly previewEl: HTMLButtonElement;
  private readonly speedBtns: Map<SpeedMultiplier, HTMLButtonElement> = new Map();
  private readonly speedCycleBtn: HTMLButtonElement;
  private readonly speedCycleVal: HTMLSpanElement;
  private readonly pauseBtn: HTMLButtonElement;

  private lastGold = -1;
  private lastLives = -1;
  private lastWaveBadgeKey = '';
  private lastWaveKey = '';
  private lastPreviewKey = '';
  private lastPreviewRef: HudStateView['nextPreview'] | undefined = undefined;
  private lastPreviewEndless = false;
  private lastPausedIcon: boolean | null = null;
  private currentSpeed: SpeedMultiplier = 1;
  private previewSummary = '';

  constructor(parent: HTMLElement, callbacks: HudCallbacks) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'hud-top ui-interactive';

    // Resource plate: lives, gold, wave counter on one slate slab.
    const leftGroup = document.createElement('div');
    leftGroup.className = 'hud-group hud-resources gx gx-slate';

    const makeStat = (cls: string, icon: string): { el: HTMLDivElement; val: HTMLSpanElement } => {
      const el = document.createElement('div');
      el.className = `hud-pill ${cls}`;
      el.innerHTML = `<span class="hud-icon">${icon}</span>`;
      const val = document.createElement('span');
      val.className = 'hud-val';
      el.appendChild(val);
      return { el, val };
    };
    const lives = makeStat('hud-lives', UI_ICON_SVGS.heart);
    const gold = makeStat('hud-gold', UI_ICON_SVGS.coin);
    const wave = makeStat('hud-wave-counter', UI_ICON_SVGS.wave);
    this.livesValEl = lives.val;
    this.goldValEl = gold.val;
    this.waveValEl = wave.val;
    leftGroup.append(lives.el, gold.el, wave.el);

    // Next-wave preview: enemy tokens + counts, tap for names.
    this.previewEl = document.createElement('button');
    this.previewEl.type = 'button';
    this.previewEl.className = 'hud-wave-preview gx gx-slate';
    this.previewEl.setAttribute('aria-label', 'Next wave preview');
    this.previewEl.addEventListener('click', () => {
      if (this.previewSummary) callbacks.onPreviewTap?.(this.previewSummary);
    });

    // Wave controls: the big gem (bottom-right on touch) plus desktop toggles.
    const centerGroup = document.createElement('div');
    centerGroup.className = 'hud-group hud-wave-ctrl';

    this.waveBtn = document.createElement('button');
    this.waveBtn.type = 'button';
    this.waveBtn.className = 'hud-wave-btn gx gx-green';
    const waveIcon = document.createElement('span');
    waveIcon.className = 'hud-wave-btn-icon';
    waveIcon.innerHTML = UI_ICON_SVGS.play;
    const waveText = document.createElement('span');
    waveText.className = 'hud-wave-btn-text';
    this.waveBtnTitle = document.createElement('span');
    this.waveBtnTitle.className = 'hud-wave-btn-title';
    this.waveBtnSub = document.createElement('span');
    this.waveBtnSub.className = 'hud-wave-btn-sub';
    waveText.append(this.waveBtnTitle, this.waveBtnSub);
    this.waveBtnShort = document.createElement('span');
    this.waveBtnShort.className = 'hud-wave-btn-short';
    this.waveBtnBonus = document.createElement('span');
    this.waveBtnBonus.className = 'hud-wave-btn-bonus';
    this.waveBtn.append(waveIcon, waveText, this.waveBtnShort, this.waveBtnBonus);
    this.waveBtn.addEventListener('click', () => callbacks.onStartWave());

    const makeToggle = (
      iconSvg: string,
      label: string,
      title: string,
      testId: string,
      onClick: () => void,
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-toggle-pill gx gx-slate-btn';
      btn.title = title;
      btn.setAttribute('data-testid', testId);
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = `<span class="hud-toggle-icon">${iconSvg}</span><span class="hud-toggle-label">${label}</span>`;
      btn.addEventListener('click', onClick);
      return btn;
    };

    this.autoWaveBtn = makeToggle(
      UI_ICON_SVGS.autoWave,
      'Auto',
      'Auto-start next waves (X)',
      'btn-hud-autowave',
      () => callbacks.onToggleAutoWave(),
    );
    this.routesBtn = makeToggle(
      UI_ICON_SVGS.lanes,
      'Lanes',
      'Toggle ground & sky lane preview (R)',
      'btn-hud-routes',
      () => callbacks.onToggleRoutes(),
    );

    centerGroup.append(this.waveBtn, this.autoWaveBtn, this.routesBtn);

    // Right cluster: camera, speed, pause / menu.
    const rightGroup = document.createElement('div');
    rightGroup.className = 'hud-group hud-actions';

    const makeIconBtn = (cls: string, title: string, icon: string, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `hud-icon-btn gx gx-slate-btn ${cls}`;
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.innerHTML = icon;
      btn.addEventListener('click', onClick);
      return btn;
    };

    const rotLeftBtn = makeIconBtn('hud-rot-btn hud-rot-left', 'Rotate camera left (Q)', UI_ICON_SVGS.rotateLeft, () =>
      callbacks.onRotateCamera(-1),
    );
    const rotRightBtn = makeIconBtn(
      'hud-rot-btn hud-rot-right',
      'Rotate camera right (E)',
      UI_ICON_SVGS.rotateRight,
      () => callbacks.onRotateCamera(1),
    );

    // Desktop: segmented 1x/2x/3x. Touch: single button that cycles.
    const speedWrap = document.createElement('div');
    speedWrap.className = 'hud-speed-wrap gx gx-slate';
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

    this.speedCycleBtn = document.createElement('button');
    this.speedCycleBtn.type = 'button';
    this.speedCycleBtn.className = 'hud-speed-cycle gx gx-slate-btn';
    this.speedCycleBtn.title = 'Game speed';
    this.speedCycleBtn.setAttribute('aria-label', 'Cycle game speed');
    this.speedCycleBtn.setAttribute('data-testid', 'btn-hud-speed');
    this.speedCycleBtn.innerHTML = `<span class="hud-speed-cycle-icon">${UI_ICON_SVGS.fast}</span>`;
    this.speedCycleVal = document.createElement('span');
    this.speedCycleVal.className = 'hud-speed-cycle-val';
    this.speedCycleVal.textContent = '1x';
    this.speedCycleBtn.appendChild(this.speedCycleVal);
    this.speedCycleBtn.addEventListener('click', () => callbacks.onSetSpeed(SPEED_CYCLE[this.currentSpeed]));

    this.pauseBtn = makeIconBtn('hud-pause-btn', 'Pause / Resume (Space)', UI_ICON_SVGS.pause, () =>
      callbacks.onTogglePause(),
    );
    const settingsBtn = makeIconBtn('hud-settings-btn', 'Settings', UI_ICON_SVGS.settings, () =>
      callbacks.onOpenSettings(),
    );
    // Menu button: hamburger on desktop, pause glyph on touch (opens the pause menu either way).
    const menuBtn = makeIconBtn(
      'hud-menu-btn',
      'Pause menu (Esc)',
      `<span class="hud-menu-glyph">${UI_ICON_SVGS.menu}</span><span class="hud-pause-glyph">${UI_ICON_SVGS.pause}</span>`,
      () => callbacks.onOpenMenu(),
    );
    menuBtn.setAttribute('data-testid', 'btn-hud-menu');

    rightGroup.append(rotLeftBtn, rotRightBtn, speedWrap, this.speedCycleBtn, this.pauseBtn, settingsBtn, menuBtn);

    centerGroup.append(this.previewEl);
    this.rootEl.append(leftGroup, centerGroup, rightGroup);
    parent.appendChild(this.rootEl);
  }

  update(view: HudStateView): void {
    if (view.gold !== this.lastGold) {
      this.lastGold = view.gold;
      this.goldValEl.textContent = String(view.gold);
    }

    if (view.lives !== this.lastLives) {
      this.lastLives = view.lives;
      this.livesValEl.textContent = String(view.lives);
    }

    const waveBadgeKey = `${view.currentWave}|${view.totalWaves}|${view.isEndless ? 1 : 0}`;
    if (waveBadgeKey !== this.lastWaveBadgeKey) {
      this.lastWaveBadgeKey = waveBadgeKey;
      this.waveValEl.textContent = view.isEndless
        ? `${view.currentWave} ∞`
        : `${view.currentWave}/${view.totalWaves}`;
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
      this.rootEl.classList.toggle('wave-locked', !view.canStartWave);
      this.waveBtnBonus.textContent = '';
      if (view.isPreFirstWave) {
        this.waveBtnTitle.textContent = 'Start Wave 1';
        this.waveBtnSub.textContent = 'Tap when ready';
        this.waveBtnShort.textContent = 'Start';
      } else if (view.canStartWave) {
        const nextNum = view.currentWave + 1;
        this.waveBtnTitle.textContent = `Next Wave ${nextNum}`;
        this.waveBtnSub.textContent =
          view.earlyBonus > 0
            ? countdownInt > 0
              ? `Call early +${view.earlyBonus}g (${countdownInt}s)`
              : `Call early +${view.earlyBonus}g`
            : 'Send wave now';
        this.waveBtnShort.textContent = 'Next';
        this.waveBtnBonus.textContent = view.earlyBonus > 0 ? `+${view.earlyBonus}g` : '';
      } else if (!view.isEndless && view.currentWave >= view.totalWaves) {
        this.waveBtnTitle.textContent = 'Final Wave';
        this.waveBtnSub.textContent = 'Hold the Skyhold!';
        this.waveBtnShort.textContent = 'Final';
      } else {
        this.waveBtnTitle.textContent = `Wave ${view.currentWave} Active`;
        this.waveBtnSub.textContent = 'Foes incoming';
        this.waveBtnShort.textContent = 'Active';
      }
    }

    // Only build the content key when the preview object changed (it is cached per wave upstream).
    if (view.nextPreview !== this.lastPreviewRef || view.isEndless !== this.lastPreviewEndless) {
      this.lastPreviewRef = view.nextPreview;
      this.lastPreviewEndless = view.isEndless;
      const previewKey = view.nextPreview
        ? `${view.nextPreview.waveOneBased}:${view.nextPreview.items.map((x) => `${x.enemyType}${x.count}`).join(',')}`
        : view.isEndless
          ? 'endless-none'
          : 'none';
      if (previewKey !== this.lastPreviewKey) {
        this.lastPreviewKey = previewKey;
        this.renderPreview(view);
      }
    }

    this.currentSpeed = view.speed;
    this.speedBtns.forEach((btn, sp) => {
      btn.classList.toggle('active', !view.paused && view.speed === sp);
    });
    this.speedCycleVal.textContent = `${view.speed}x`;
    this.speedCycleBtn.classList.toggle('is-fast', view.speed > 1);
    if (view.paused !== this.lastPausedIcon) {
      this.lastPausedIcon = view.paused;
      this.pauseBtn.classList.toggle('active', view.paused);
      this.pauseBtn.innerHTML = view.paused ? UI_ICON_SVGS.play : UI_ICON_SVGS.pause;
    }
  }

  private renderPreview(view: HudStateView): void {
    this.previewEl.innerHTML = '';
    this.previewSummary = '';
    this.previewEl.classList.toggle('is-empty', !view.nextPreview);
    if (view.nextPreview) {
      const lbl = document.createElement('span');
      lbl.className = 'hud-preview-label';
      lbl.textContent = `W${view.nextPreview.waveOneBased}`;
      this.previewEl.appendChild(lbl);
      const names: string[] = [];
      for (let i = 0; i < view.nextPreview.items.length; i++) {
        const item = view.nextPreview.items[i];
        const meta = ENEMY_BADGE_META[item.enemyType];
        const chip = document.createElement('span');
        const air = item.enemyType === 'flyer';
        chip.className = `hud-preview-chip${air ? ' is-air' : ''}${air && item.count >= 3 ? ' hud-preview-chip-flyer-warn' : ''}`;
        chip.setAttribute('data-enemy', item.enemyType);
        chip.innerHTML = `<span class="hud-preview-icon">${ENEMY_ICON_SVGS[item.enemyType]}</span><b>${item.count}</b>`;
        this.previewEl.appendChild(chip);
        names.push(`${item.count}× ${meta.label}`);
      }
      const hasAirWarn = view.nextPreview.items.some((x) => x.enemyType === 'flyer' && x.count >= 3);
      this.previewSummary = `Wave ${view.nextPreview.waveOneBased}: ${names.join(', ')}${
        hasAirWarn ? ' — only Archer, Frost and Tesla hit air' : ''
      }`;
      this.previewEl.title = this.previewSummary;
    } else {
      const lbl = document.createElement('span');
      lbl.className = 'hud-preview-label hud-preview-final';
      lbl.textContent = view.isEndless ? 'Endless' : 'Final wave';
      this.previewEl.appendChild(lbl);
      this.previewEl.title = '';
    }
  }

  setVisible(visible: boolean): void {
    this.rootEl.classList.toggle('hidden', !visible);
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
