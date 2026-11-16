import type { TowerMvpSummary } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import type { LevelDef } from '../data/levels/index.ts';
import { TOWER_ICON_SVGS } from './icons.ts';
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
  onRestart: () => void;
  onOpenSettings: () => void;
  onOpenLevelSelect: () => void;
  onMainMenu: () => void;
}

export class PauseMenuModal {
  private readonly backdrop: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private open = false;

  constructor(parent: HTMLElement, callbacks: PauseMenuCallbacks) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop hidden ui-interactive';
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) callbacks.onResume();
    });

    const card = document.createElement('div');
    card.className = 'modal-card pause-card';

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = 'Game Paused';

    this.subtitleEl = document.createElement('div');
    this.subtitleEl.className = 'modal-subtitle';

    const stack = document.createElement('div');
    stack.className = 'pause-menu-stack';

    const makeBtn = (label: string, primary: boolean, onClick: () => void, testId?: string) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = primary ? 'btn-primary btn-lg' : 'btn-secondary btn-lg';
      btn.textContent = label;
      if (testId) btn.setAttribute('data-testid', testId);
      btn.addEventListener('click', onClick);
      return btn;
    };

    stack.append(
      makeBtn('Resume Defense', true, callbacks.onResume, 'btn-pause-resume'),
      makeBtn('Restart Island', false, callbacks.onRestart, 'btn-pause-restart'),
      makeBtn('Settings', false, callbacks.onOpenSettings, 'btn-pause-settings'),
      makeBtn('Level Select', false, callbacks.onOpenLevelSelect, 'btn-pause-levels'),
      makeBtn('Main Menu', false, callbacks.onMainMenu, 'btn-pause-menu'),
    );

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
    card.className = 'modal-card outcome-card';

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
    this.mvpEl.style.width = '100%';
    this.mvpEl.style.display = 'flex';
    this.mvpEl.style.alignItems = 'center';
    this.mvpEl.style.gap = '10px';
    this.mvpEl.style.padding = '8px 12px';
    this.mvpEl.style.borderRadius = '12px';
    this.mvpEl.style.background = 'rgba(246, 189, 65, 0.16)';
    this.mvpEl.style.border = '1px solid rgba(246, 189, 65, 0.48)';
    this.mvpEl.style.textAlign = 'left';

    const actions = document.createElement('div');
    actions.className = 'pause-menu-stack';

    this.nextBtn = document.createElement('button');
    this.nextBtn.type = 'button';
    this.nextBtn.className = 'btn-primary btn-lg';
    this.nextBtn.textContent = 'Next Island';
    this.nextBtn.setAttribute('data-testid', 'btn-outcome-next');
    this.nextBtn.addEventListener('click', () => callbacks.onNextLevel());

    this.endlessBtn = document.createElement('button');
    this.endlessBtn.type = 'button';
    this.endlessBtn.className = 'btn-secondary btn-lg';
    this.endlessBtn.textContent = 'Continue Endless';
    this.endlessBtn.setAttribute('data-testid', 'btn-outcome-endless');
    this.endlessBtn.addEventListener('click', () => callbacks.onEndlessMode());

    this.replayBtn = document.createElement('button');
    this.replayBtn.type = 'button';
    this.replayBtn.className = 'btn-secondary btn-lg';
    this.replayBtn.setAttribute('data-testid', 'btn-outcome-replay');
    this.replayBtn.addEventListener('click', () => callbacks.onReplay());

    const levelsBtn = document.createElement('button');
    levelsBtn.type = 'button';
    levelsBtn.className = 'btn-secondary btn-lg';
    levelsBtn.textContent = 'Level Select';
    levelsBtn.setAttribute('data-testid', 'btn-outcome-levels');
    levelsBtn.addEventListener('click', () => callbacks.onLevelSelect());

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'btn-secondary btn-lg';
    menuBtn.textContent = 'Main Menu';
    menuBtn.setAttribute('data-testid', 'btn-outcome-menu');
    menuBtn.addEventListener('click', () => callbacks.onMainMenu());

    actions.append(this.nextBtn, this.endlessBtn, this.replayBtn, levelsBtn, menuBtn);
    card.append(this.badgeEl, this.titleEl, this.subEl, this.starsEl, this.statsEl, this.mvpEl, actions);
    this.backdrop.appendChild(card);
    parent.appendChild(this.backdrop);
  }

  private renderMvp(mvp: TowerMvpSummary | null | undefined): void {
    this.mvpEl.innerHTML = '';
    if (!mvp) {
      this.mvpEl.classList.add('hidden');
      return;
    }

    const iconWrap = document.createElement('div');
    iconWrap.style.width = '28px';
    iconWrap.style.height = '28px';
    iconWrap.style.padding = '3px';
    iconWrap.style.borderRadius = '8px';
    iconWrap.style.background = 'rgba(248, 244, 232, 0.85)';
    iconWrap.style.flexShrink = '0';
    iconWrap.innerHTML = TOWER_ICON_SVGS[mvp.type];

    const textCol = document.createElement('div');
    textCol.style.flex = '1';
    textCol.style.minWidth = '0';
    textCol.style.display = 'flex';
    textCol.style.flexDirection = 'column';
    textCol.style.gap = '1px';

    const titleLine = document.createElement('div');
    titleLine.style.fontSize = '11.5px';
    titleLine.style.fontWeight = '800';
    titleLine.style.color = 'var(--pal-indigo)';
    titleLine.textContent = `MVP · ${mvp.name} ${tierToRoman(mvp.tier)}`;

    const statsLine = document.createElement('div');
    statsLine.style.fontSize = '11px';
    statsLine.style.fontWeight = '700';
    statsLine.style.fontFamily = 'var(--font-mono)';
    statsLine.style.color = 'var(--ui-dark-soft)';
    statsLine.textContent = `${formatMvpDamage(mvp.damageDealt)} DMG · ${mvp.kills} ${mvp.kills === 1 ? 'Kill' : 'Kills'}`;

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
    this.badgeEl.textContent = 'ISLAND DEFENDED';
    this.titleEl.textContent = 'Victory!';
    this.subEl.textContent = `${level.name} secured from invaders.`;
    this.starsEl.innerHTML = renderStarsHtml(stars);
    this.starsEl.classList.remove('hidden');
    this.statsEl.innerHTML = `
      <div class="outcome-stat"><span>Lives Left</span><strong>${livesRemaining} / ${BALANCE.startingLives}</strong></div>
      <div class="outcome-stat"><span>Waves Cleared</span><strong>${level.waves.length} / ${level.waves.length}</strong></div>
      <div class="outcome-stat"><span>Foes Vanquished</span><strong>${enemiesKilled}</strong></div>
    `;
    this.renderMvp(mvp);
    this.nextBtn.classList.toggle('hidden', !hasNext);
    this.endlessBtn.classList.remove('hidden');
    this.endlessBtn.className = hasNext ? 'btn-secondary btn-lg' : 'btn-primary btn-lg';
    this.replayBtn.className = 'btn-secondary btn-lg';
    this.replayBtn.textContent = 'Replay Island';
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
      this.badgeEl.textContent = 'ENDLESS CONCLUDED';
      this.titleEl.textContent = 'Endless Fallen';
      this.subEl.textContent = `Held out until Wave ${waveReached} on ${level.name}!`;
      this.starsEl.innerHTML = renderStarsHtml(earnedStars);
      this.starsEl.classList.remove('hidden');
      this.statsEl.innerHTML = `
        <div class="outcome-stat"><span>Lives Left</span><strong>0 / ${BALANCE.startingLives}</strong></div>
        <div class="outcome-stat"><span>Wave Reached</span><strong>Wave ${waveReached} ∞</strong></div>
        <div class="outcome-stat"><span>Foes Vanquished</span><strong>${enemiesKilled}</strong></div>
      `;
    } else {
      this.badgeEl.className = 'outcome-badge outcome-badge-lose';
      this.badgeEl.textContent = 'SANCTUARY BREACHED';
      this.titleEl.textContent = 'Defeat';
      this.subEl.textContent = `${level.name} fell on Wave ${waveReached}.`;
      this.starsEl.innerHTML = renderStarsHtml(earnedStars);
      this.starsEl.classList.remove('hidden');
      this.statsEl.innerHTML = `
        <div class="outcome-stat"><span>Lives Left</span><strong>0 / ${BALANCE.startingLives}</strong></div>
        <div class="outcome-stat"><span>Wave Reached</span><strong>${waveReached} / ${level.waves.length}</strong></div>
        <div class="outcome-stat"><span>Foes Vanquished</span><strong>${enemiesKilled}</strong></div>
      `;
    }

    this.renderMvp(options?.mvp);
    this.nextBtn.classList.add('hidden');
    this.endlessBtn.classList.add('hidden');
    this.replayBtn.className = 'btn-primary btn-lg';
    this.replayBtn.textContent = 'Retry Island';
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
