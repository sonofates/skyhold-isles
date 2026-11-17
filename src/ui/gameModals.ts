import type { TowerMvpSummary } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import type { LevelDef } from '../data/levels/index.ts';
import { describeStarGoals } from '../data/stars.ts';
import type { WinRecord } from '../game/progression.ts';
import { TOWER_ICON_SVGS, UI_ICON_SVGS } from './icons.ts';
import { renderStarsHtml } from './menus.ts';
import './styles/starReveal.css';

/** When each victory star stamps in (ms after the card opens); the session plays chimes in sync. */
export const STAR_REVEAL_DELAYS_MS: readonly number[] = [650, 1000, 1350];

/** Victory stars: empty slots first, then each earned star stamps in; stars beyond the old best get a NEW tag. */
export function renderStarRevealHtml(stars: number, previousBest: number): string {
  let out = '';
  for (let i = 1; i <= 3; i++) {
    const earned = i <= stars;
    const isNew = earned && i > previousBest;
    const delay = STAR_REVEAL_DELAYS_MS[i - 1] ?? 0;
    out += `<span class="star-slot${earned ? ' earned' : ' empty'}${isNew ? ' star-new' : ''}" style="--reveal-delay:${delay}ms">`;
    out += `<span class="star-layer star-layer-empty">${UI_ICON_SVGS.starEmpty}</span>`;
    if (earned) {
      out += `<span class="star-burst"></span><span class="star-layer star-layer-fill">${UI_ICON_SVGS.star}</span>`;
      if (isNew && previousBest > 0) out += `<span class="star-new-tag">NEW</span>`;
    }
    out += '</span>';
  }
  return out;
}

/** Endless results card data (built by the session from the run + saved record). */
export interface EndlessResultView {
  readonly best: number;
  readonly previousBest: number;
  readonly isNewBest: boolean;
  readonly endlessWavesCleared: number;
  readonly mutators: readonly string[];
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

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
  private readonly calloutsEl: HTMLDivElement;
  private readonly goalsEl: HTMLDivElement;
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

    this.calloutsEl = document.createElement('div');
    this.calloutsEl.className = 'outcome-callouts';

    this.goalsEl = document.createElement('div');
    this.goalsEl.className = 'outcome-star-goals hidden';

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
    card.append(
      this.badgeEl,
      this.titleEl,
      this.subEl,
      this.starsEl,
      this.calloutsEl,
      this.goalsEl,
      this.statsEl,
      this.mvpEl,
      actions,
    );
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
    extras?: {
      record?: WinRecord;
      startingLives?: number;
      unlockedName?: string;
      /** Challenges completed for the first time by this win. */
      newChallengeNames?: readonly string[];
    },
  ): void {
    this.open = true;
    const record = extras?.record;
    const startingLives = extras?.startingLives ?? BALANCE.startingLives;
    this.badgeEl.className = 'outcome-badge outcome-badge-win';
    this.badgeEl.textContent = 'Island defended';
    this.titleEl.textContent = 'Victory';
    this.subEl.textContent = level.name;
    this.starsEl.className = 'outcome-stars star-reveal';
    this.starsEl.innerHTML = renderStarRevealHtml(stars, record?.previousBestStars ?? 0);
    this.starsEl.classList.remove('hidden');
    this.renderCallouts(stars, record, extras?.unlockedName, extras?.newChallengeNames ?? []);
    if (stars < 3) {
      const goals = describeStarGoals(level.difficulty);
      this.goalsEl.innerHTML = `${level.difficulty}: <b>3★</b> ${goals.three} · <b>2★</b> ${goals.two}`;
      this.goalsEl.classList.remove('hidden');
    } else {
      this.goalsEl.classList.add('hidden');
    }
    this.statsEl.innerHTML = `
      <div class="outcome-stat"><span>Lives</span><strong>${livesRemaining} / ${startingLives}</strong></div>
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

  private renderCallouts(
    stars: number,
    record: WinRecord | undefined,
    unlockedName: string | undefined,
    challengeNames: readonly string[],
  ): void {
    const chips: string[] = [];
    let delay = (STAR_REVEAL_DELAYS_MS[Math.max(0, stars - 1)] ?? 0) + 380;
    const chip = (cls: string, icon: string, text: string): void => {
      chips.push(
        `<span class="outcome-callout ${cls}" style="--reveal-delay:${delay}ms">${icon}<span>${escapeHtml(text)}</span></span>`,
      );
      delay += 160;
    };
    if (record) {
      if (record.firstClear) chip('callout-first', UI_ICON_SVGS.star, 'First clear!');
      else if (record.starsGained > 0) chip('callout-best', UI_ICON_SVGS.star, `+${record.starsGained}★ new best`);
      else if (record.newBestLives) chip('callout-best', UI_ICON_SVGS.heart, 'Best defence yet');
    }
    for (const name of challengeNames) chip('callout-challenge', UI_ICON_SVGS.star, `${name} +1★`);
    if (unlockedName) chip('callout-unlock', UI_ICON_SVGS.islands, `${unlockedName} unlocked`);
    this.calloutsEl.innerHTML = chips.join('');
  }

  showLose(
    level: LevelDef,
    waveOneBased: number,
    enemiesKilled: number,
    options?: {
      isEndless?: boolean;
      mvp?: TowerMvpSummary | null;
      earnedStars?: number;
      endless?: EndlessResultView;
      startingLives?: number;
    },
  ): void {
    this.open = true;
    const waveReached = Math.max(1, waveOneBased);
    const isEndless = Boolean(options?.isEndless);
    const earnedStars = options?.earnedStars ?? 0;
    const startingLives = options?.startingLives ?? BALANCE.startingLives;
    this.starsEl.className = 'outcome-stars';
    this.calloutsEl.innerHTML = '';
    this.goalsEl.classList.add('hidden');

    if (isEndless) {
      const res = options?.endless;
      this.badgeEl.className = 'outcome-badge outcome-badge-endless';
      this.badgeEl.textContent = `Endless · ${level.name}`;
      this.titleEl.textContent = `Wave ${waveReached}`;
      this.subEl.textContent = res
        ? res.isNewBest
          ? res.previousBest > 0
            ? `New personal best (was wave ${res.previousBest})`
            : 'First endless record on this island'
          : `Personal best: wave ${res.best}`
        : 'The sanctuary finally fell';
      this.starsEl.classList.add('hidden');
      if (res?.isNewBest) {
        this.calloutsEl.innerHTML = `<span class="outcome-callout callout-best" style="--reveal-delay:350ms">${UI_ICON_SVGS.star}<span>New best!</span></span>`;
      }
      if (res && res.mutators.length > 0) {
        const chips = res.mutators.map((m) => `<span class="endless-mutator-chip">${escapeHtml(m)}</span>`).join('');
        this.goalsEl.innerHTML = `<span class="endless-mutators-label">Mutators faced</span>${chips}`;
        this.goalsEl.classList.remove('hidden');
      }
      this.statsEl.innerHTML = `
        <div class="outcome-stat"><span>Endless waves</span><strong>${res?.endlessWavesCleared ?? 0}</strong></div>
        <div class="outcome-stat"><span>Best</span><strong>W${res?.best ?? waveReached}</strong></div>
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
        <div class="outcome-stat"><span>Lives</span><strong>0 / ${startingLives}</strong></div>
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
