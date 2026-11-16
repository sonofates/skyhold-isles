import type { TowerMvpSummary } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import type { LevelDef } from '../data/levels/index.ts';
import { TOWER_ICON_SVGS, UI_ICON_SVGS } from './icons.ts';
import { renderStarsHtml } from './menus.ts';

function tierToRoman(tier: 1 | 2 | 3): string {
  return tier === 3 ? 'III' : tier === 2 ? 'II' : 'I';
}

function formatMvpDamage(rawDamage: number): string {
  const rounded = Math.max(0, Math.round(rawDamage));
  if (rounded >= 1_000_000) {
    return `${(rounded / 1_000_000).toFixed(1)}M`;
  }
  if (rounded >= 1000) {
    return `${(rounded / 1000).toFixed(1)}k`;
  }
  return String(rounded);
}

export interface PauseMenuCallbacks {
  onResume: () => void;
  onToggleAutoWave?: () => void;
  onToggleRoutes?: () => void;
  onRestart: () => void;
  onOpenSettings: () => void;
  onOpenLevelSelect: () => void;
  onMainMenu: () => void;
}

export class PauseMenuModal {
  private readonly backdrop: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly autoBtn: HTMLButtonElement;
  private readonly lanesBtn: HTMLButtonElement;
  private open = false;

  constructor(parent: HTMLElement, callbacks: PauseMenuCallbacks) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop hidden ui-interactive';
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) callbacks.onResume();
    });

    const card = document.createElement('div');
    card.className = 'modal-card pause-card gx gx-slate';

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = 'Paused';

    this.subtitleEl = document.createElement('div');
    this.subtitleEl.className = 'modal-subtitle';

    const stack = document.createElement('div');
    stack.className = 'pause-menu-stack';

    const makeBtn = (
      label: string,
      icon: string,
      variant: 'green' | 'slate',
      onClick: () => void,
      testId?: string,
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        variant === 'green'
          ? 'btn-primary btn-lg gx gx-green'
          : 'btn-secondary gx gx-slate-btn pause-tile';
      btn.innerHTML = `<span class="btn-icon">${icon}</span><span class="btn-label">${label}</span>`;
      if (testId) btn.setAttribute('data-testid', testId);
      btn.addEventListener('click', onClick);
      return btn;
    };

    const makeToggle = (label: string, icon: string, onClick: (() => void) | undefined, testId: string) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pause-toggle gx gx-slate-btn';
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('data-testid', testId);
      btn.innerHTML = `<span class="btn-icon">${icon}</span><span class="btn-label">${label}</span><span class="pause-switch" aria-hidden="true"></span>`;
      btn.addEventListener('click', () => onClick?.());
      return btn;
    };

    this.autoBtn = makeToggle('Auto wave', UI_ICON_SVGS.autoWave, callbacks.onToggleAutoWave, 'btn-pause-autowave');
    this.lanesBtn = makeToggle('Lanes', UI_ICON_SVGS.lanes, callbacks.onToggleRoutes, 'btn-pause-lanes');
    const toggles = document.createElement('div');
    toggles.className = 'pause-toggles';
    toggles.append(this.autoBtn, this.lanesBtn);

    const tiles = document.createElement('div');
    tiles.className = 'pause-tiles';
    tiles.append(
      makeBtn('Restart', UI_ICON_SVGS.restart, 'slate', callbacks.onRestart, 'btn-pause-restart'),
      makeBtn('Settings', UI_ICON_SVGS.settings, 'slate', callbacks.onOpenSettings, 'btn-pause-settings'),
      makeBtn('Islands', UI_ICON_SVGS.islands, 'slate', callbacks.onOpenLevelSelect, 'btn-pause-levels'),
      makeBtn('Menu', UI_ICON_SVGS.home, 'slate', callbacks.onMainMenu, 'btn-pause-menu'),
    );

    stack.append(makeBtn('Resume', UI_ICON_SVGS.play, 'green', callbacks.onResume, 'btn-pause-resume'), toggles, tiles);

    card.append(title, this.subtitleEl, stack);
    this.backdrop.appendChild(card);
    parent.appendChild(this.backdrop);
  }

  setOpen(open: boolean, levelLabel?: string): void {
    this.open = open;
    if (levelLabel !== undefined) {
      this.subtitleEl.textContent = levelLabel;
    }
    this.backdrop.classList.toggle('hidden', !open);
  }

  setToggles(autoWave: boolean, routesVisible: boolean): void {
    this.autoBtn.classList.toggle('active', autoWave);
    this.autoBtn.setAttribute('aria-pressed', autoWave ? 'true' : 'false');
    this.lanesBtn.classList.toggle('active', routesVisible);
    this.lanesBtn.setAttribute('aria-pressed', routesVisible ? 'true' : 'false');
  }

  isOpen(): boolean {
    return this.open;
  }

  dispose(): void {
    this.backdrop.remove();
  }
}

export interface OutcomeCallbacks {
  onNextLevel: () => void;
  onEndlessMode: () => void;
  onReplay: () => void;
  onLevelSelect: () => void;
  onMainMenu: () => void;
}

export class OutcomeOverlay {
  private readonly backdrop: HTMLDivElement;
  private readonly badgeEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subEl: HTMLDivElement;
  private readonly starsEl: HTMLDivElement;
  private readonly statsEl: HTMLDivElement;
  private readonly mvpEl: HTMLDivElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly endlessBtn: HTMLButtonElement;
  private readonly replayBtn: HTMLButtonElement;
  private open = false;

  constructor(parent: HTMLElement, callbacks: OutcomeCallbacks) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop hidden ui-interactive';

    const card = document.createElement('div');
    card.className = 'modal-card outcome-card gx gx-slate';

    this.badgeEl = document.createElement('div');
    this.badgeEl.className = 'outcome-badge';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'outcome-title';

    this.subEl = document.createElement('div');
    this.subEl.className = 'modal-subtitle';

    this.starsEl = document.createElement('div');
    this.starsEl.className = 'outcome-stars';

    this.statsEl = document.createElement('div');
    this.statsEl.className = 'outcome-stats';

    this.mvpEl = document.createElement('div');
    this.mvpEl.className = 'outcome-mvp hidden';

    const actions = document.createElement('div');
    actions.className = 'pause-menu-stack outcome-actions';

    this.nextBtn = document.createElement('button');
    this.nextBtn.type = 'button';
    this.nextBtn.setAttribute('data-testid', 'btn-outcome-next');
    this.nextBtn.addEventListener('click', () => callbacks.onNextLevel());
    OutcomeOverlay.styleBtn(this.nextBtn, 'green', 'Next island', UI_ICON_SVGS.play);

    this.endlessBtn = document.createElement('button');
    this.endlessBtn.type = 'button';
    this.endlessBtn.setAttribute('data-testid', 'btn-outcome-endless');
    this.endlessBtn.addEventListener('click', () => callbacks.onEndlessMode());
    OutcomeOverlay.styleBtn(this.endlessBtn, 'sky', 'Endless', UI_ICON_SVGS.autoWave);

    this.replayBtn = document.createElement('button');
    this.replayBtn.type = 'button';
    this.replayBtn.setAttribute('data-testid', 'btn-outcome-replay');
    this.replayBtn.addEventListener('click', () => callbacks.onReplay());
    OutcomeOverlay.styleBtn(this.replayBtn, 'slate', 'Replay', UI_ICON_SVGS.restart);

    const levelsBtn = document.createElement('button');
    levelsBtn.type = 'button';
    levelsBtn.setAttribute('data-testid', 'btn-outcome-levels');
    levelsBtn.addEventListener('click', () => callbacks.onLevelSelect());
    OutcomeOverlay.styleBtn(levelsBtn, 'tile', 'Islands', UI_ICON_SVGS.islands);

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.setAttribute('data-testid', 'btn-outcome-menu');
    menuBtn.addEventListener('click', () => callbacks.onMainMenu());
    OutcomeOverlay.styleBtn(menuBtn, 'tile', 'Menu', UI_ICON_SVGS.home);

    const tileRow = document.createElement('div');
    tileRow.className = 'pause-tiles';
    tileRow.append(levelsBtn, menuBtn);
    actions.append(this.nextBtn, this.endlessBtn, this.replayBtn, tileRow);
    card.append(this.badgeEl, this.titleEl, this.subEl, this.starsEl, this.statsEl, this.mvpEl, actions);
    this.backdrop.appendChild(card);
    parent.appendChild(this.backdrop);
  }

  private static styleBtn(
    btn: HTMLButtonElement,
    kind: 'green' | 'sky' | 'slate' | 'tile',
    label: string,
    icon: string,
  ): void {
    const cls = {
      green: 'btn-primary btn-lg gx gx-green',
      sky: 'btn-secondary btn-lg gx gx-sky',
      slate: 'btn-secondary btn-lg gx gx-slate-btn',
      tile: 'btn-secondary gx gx-slate-btn pause-tile',
    }[kind];
    btn.className = cls;
    btn.innerHTML = `<span class="btn-icon">${icon}</span><span class="btn-label">${label}</span>`;
  }

  private renderMvp(mvp: TowerMvpSummary | null | undefined): void {
    this.mvpEl.innerHTML = '';
    if (!mvp) {
      this.mvpEl.classList.add('hidden');
      return;
    }

    const iconWrap = document.createElement('div');
    iconWrap.className = 'outcome-mvp-icon';
    iconWrap.innerHTML = TOWER_ICON_SVGS[mvp.type];

    const textCol = document.createElement('div');
    textCol.className = 'outcome-mvp-text';

    const titleLine = document.createElement('div');
    titleLine.className = 'outcome-mvp-title';
    titleLine.textContent = `MVP · ${mvp.name} ${tierToRoman(mvp.tier)}`;

    const statsLine = document.createElement('div');
    statsLine.className = 'outcome-mvp-stats';
    statsLine.textContent = `${formatMvpDamage(mvp.damageDealt)} DMG · ${mvp.kills} ${mvp.kills === 1 ? 'kill' : 'kills'}`;

    textCol.append(titleLine, statsLine);
    this.mvpEl.append(iconWrap, textCol);
    this.mvpEl.classList.remove('hidden');
  }

  showWin(
    level: LevelDef,
    stars: 1 | 2 | 3,
    livesRemaining: number,
    enemiesKilled: number,
    hasNext: boolean,
    mvp?: TowerMvpSummary | null,
  ): void {
    this.open = true;
    this.badgeEl.className = 'outcome-badge outcome-badge-win';
    this.badgeEl.textContent = 'Island defended';
    this.titleEl.textContent = 'Victory';
    this.subEl.textContent = level.name;
    this.starsEl.innerHTML = renderStarsHtml(stars);
    this.starsEl.classList.remove('hidden');
    this.statsEl.innerHTML = `
      <div class="outcome-stat"><span>Lives</span><strong>${livesRemaining} / ${BALANCE.startingLives}</strong></div>
      <div class="outcome-stat"><span>Waves</span><strong>${level.waves.length} / ${level.waves.length}</strong></div>
      <div class="outcome-stat"><span>Foes</span><strong>${enemiesKilled}</strong></div>
    `;
    this.renderMvp(mvp);
    this.nextBtn.classList.toggle('hidden', !hasNext);
    this.endlessBtn.classList.remove('hidden');
    OutcomeOverlay.styleBtn(this.endlessBtn, hasNext ? 'sky' : 'green', 'Endless', UI_ICON_SVGS.autoWave);
    OutcomeOverlay.styleBtn(this.replayBtn, 'slate', 'Replay', UI_ICON_SVGS.restart);
    this.backdrop.classList.remove('hidden');
  }

  showLose(
    level: LevelDef,
    waveOneBased: number,
    enemiesKilled: number,
    options?: {
      isEndless?: boolean;
      mvp?: TowerMvpSummary | null;
      earnedStars?: number;
    },
  ): void {
    this.open = true;
    const waveReached = Math.max(1, waveOneBased);
    const isEndless = Boolean(options?.isEndless);
    const earnedStars = options?.earnedStars ?? 0;

    if (isEndless) {
      this.badgeEl.className = 'outcome-badge outcome-badge-lose outcome-badge-endless';
      this.badgeEl.textContent = 'Endless over';
      this.titleEl.textContent = 'Endless Fallen';
      this.subEl.textContent = `${level.name} · wave ${waveReached}`;
      this.starsEl.innerHTML = renderStarsHtml(earnedStars);
      this.starsEl.classList.remove('hidden');
      this.statsEl.innerHTML = `
        <div class="outcome-stat"><span>Lives</span><strong>0 / ${BALANCE.startingLives}</strong></div>
        <div class="outcome-stat"><span>Wave</span><strong>Wave ${waveReached} ∞</strong></div>
        <div class="outcome-stat"><span>Foes</span><strong>${enemiesKilled}</strong></div>
      `;
    } else {
      this.badgeEl.className = 'outcome-badge outcome-badge-lose';
      this.badgeEl.textContent = 'Sanctuary breached';
      this.titleEl.textContent = 'Defeat';
      this.subEl.textContent = `${level.name} fell on wave ${waveReached}`;
      this.starsEl.innerHTML = renderStarsHtml(earnedStars);
      this.starsEl.classList.remove('hidden');
      this.statsEl.innerHTML = `
        <div class="outcome-stat"><span>Lives</span><strong>0 / ${BALANCE.startingLives}</strong></div>
        <div class="outcome-stat"><span>Wave</span><strong>${waveReached} / ${level.waves.length}</strong></div>
        <div class="outcome-stat"><span>Foes</span><strong>${enemiesKilled}</strong></div>
      `;
    }

    this.renderMvp(options?.mvp);
    this.nextBtn.classList.add('hidden');
    this.endlessBtn.classList.add('hidden');
    OutcomeOverlay.styleBtn(this.replayBtn, 'green', 'Retry', UI_ICON_SVGS.restart);
    this.backdrop.classList.remove('hidden');
  }

  hide(): void {
    this.open = false;
    this.backdrop.classList.add('hidden');
  }

  isOpen(): boolean {
    return this.open;
  }

  dispose(): void {
    this.backdrop.remove();
  }
}
