import { BALANCE } from '../data/balance.ts';
import type { LevelDef } from '../data/levels/index.ts';
import { renderStarsHtml } from './menus.ts';

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
  private readonly nextBtn: HTMLButtonElement;
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

    const actions = document.createElement('div');
    actions.className = 'pause-menu-stack';

    this.nextBtn = document.createElement('button');
    this.nextBtn.type = 'button';
    this.nextBtn.className = 'btn-primary btn-lg';
    this.nextBtn.textContent = 'Next Island';
    this.nextBtn.setAttribute('data-testid', 'btn-outcome-next');
    this.nextBtn.addEventListener('click', () => callbacks.onNextLevel());

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

    actions.append(this.nextBtn, this.replayBtn, levelsBtn, menuBtn);
    card.append(this.badgeEl, this.titleEl, this.subEl, this.starsEl, this.statsEl, actions);
    this.backdrop.appendChild(card);
    parent.appendChild(this.backdrop);
  }

  showWin(
    level: LevelDef,
    stars: 1 | 2 | 3,
    livesRemaining: number,
    enemiesKilled: number,
    hasNext: boolean,
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
    this.nextBtn.classList.toggle('hidden', !hasNext);
    this.replayBtn.className = hasNext ? 'btn-secondary btn-lg' : 'btn-primary btn-lg';
    this.replayBtn.textContent = 'Replay Island';
    this.backdrop.classList.remove('hidden');
  }

  showLose(level: LevelDef, waveOneBased: number, enemiesKilled: number): void {
    this.open = true;
    this.badgeEl.className = 'outcome-badge outcome-badge-lose';
    this.badgeEl.textContent = 'SANCTUARY BREACHED';
    this.titleEl.textContent = 'Defeat';
    this.subEl.textContent = `${level.name} fell on Wave ${Math.max(1, waveOneBased)}.`;
    this.starsEl.innerHTML = renderStarsHtml(0);
    this.starsEl.classList.remove('hidden');
    this.statsEl.innerHTML = `
      <div class="outcome-stat"><span>Lives Left</span><strong>0 / ${BALANCE.startingLives}</strong></div>
      <div class="outcome-stat"><span>Wave Reached</span><strong>${Math.max(1, waveOneBased)} / ${level.waves.length}</strong></div>
      <div class="outcome-stat"><span>Foes Vanquished</span><strong>${enemiesKilled}</strong></div>
    `;
    this.nextBtn.classList.add('hidden');
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
