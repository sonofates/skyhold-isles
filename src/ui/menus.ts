import type { ProgressData } from '../core/types.ts';
import { CHALLENGES, challengesForLevel, type ChallengeId } from '../data/challenges.ts';
import { LEVELS } from '../data/levels/index.ts';
import { TOWER_ICON_SVGS, UI_ICON_SVGS } from './icons.ts';
import { affordableUpgradeCount, WORKSHOP_ICON_SVG } from './workshop.ts';
import { isIslandMastered } from '../game/progression.ts';

/** Small crown for islands with 3 stars and every challenge won. */
export const MASTERED_CROWN_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8L7.5 12L12 5L16.5 12L21 8L19 18H5L3 8Z" fill="#f6bd41" stroke="#1b1936" stroke-width="2" stroke-linejoin="round"/><rect x="5" y="18" width="14" height="2.6" fill="#b8801c" stroke="#1b1936" stroke-width="1.6"/></svg>`;

/** Gold count bubble on a Workshop entry button when an upgrade is affordable. */
function setWorkshopBadge(btn: HTMLButtonElement, progress: ProgressData): void {
  btn.querySelector('.ws-badge')?.remove();
  const n = affordableUpgradeCount(progress);
  if (n > 0) {
    const badge = document.createElement('span');
    badge.className = 'ws-badge';
    badge.textContent = String(n);
    badge.setAttribute('aria-label', `${n} upgrade${n === 1 ? '' : 's'} affordable`);
    btn.appendChild(badge);
  }
}

export function renderStarsHtml(earned: number): string {
  let out = '';
  for (let i = 1; i <= 3; i++) {
    out += `<span class="star-slot ${i <= earned ? 'earned' : 'empty'}">${
      i <= earned ? UI_ICON_SVGS.star : UI_ICON_SVGS.starEmpty
    }</span>`;
  }
  return out;
}

const DIFFICULTY_CLASS: Record<string, string> = {
  Breezy: 'diff-breezy',
  Challenging: 'diff-challenging',
  Heroic: 'diff-heroic',
  Master: 'diff-master',
};

const GEM_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5L14 6L8 14.5L2 6L8 1.5Z" fill="currentColor" stroke="#1b1936" stroke-width="1.4" stroke-linejoin="round"/><path d="M2 6H14M8 1.5L5.5 6L8 14.5L10.5 6L8 1.5Z" stroke="#1b1936" stroke-opacity=".45" stroke-width="1" stroke-linejoin="round" fill="none"/></svg>`;

/** Faceted floating-island token art; tint shifts slightly per island so the carousel isn't uniform. */
function islandGlyphSvg(index: number): string {
  const tops = ['#7ec850', '#8ccf4e', '#6fbf45', '#86c95a', '#78c24a'];
  const top = tops[index % tops.length];
  return `<svg viewBox="0 0 96 64" aria-hidden="true">
    <path d="M10 26L48 8L86 26L48 44Z" fill="${top}" stroke="#1b1936" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M10 26L48 44L48 58L22 40L10 26Z" fill="#9c6b49" stroke="#1b1936" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M86 26L48 44L48 58L74 40L86 26Z" fill="#7a5238" stroke="#1b1936" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M48 8L86 26L48 44L58 26Z" fill="#fff" fill-opacity=".14"/>
    <path d="M44 28L50 14L56 28Z" fill="#4d9440" stroke="#1b1936" stroke-width="2" stroke-linejoin="round"/>
    <path d="M26 26L30 19L34 26Z" fill="#4d9440" stroke="#1b1936" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M30 29L48 38L66 29" stroke="#e6cfa3" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`;
}

export interface MainMenuCallbacks {
  onPlay: (levelIndex: number) => void;
  onOpenLevelSelect: () => void;
  onOpenSettings: () => void;
  onOpenWorkshop?: () => void;
}

export class MainMenuOverlay {
  private readonly rootEl: HTMLDivElement;
  private readonly summaryEl: HTMLDivElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly workshopBtn: HTMLButtonElement;
  private targetLevelIndex = 0;

  constructor(parent: HTMLElement, callbacks: MainMenuCallbacks) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'menu-screen hidden ui-interactive';

    const card = document.createElement('div');
    card.className = 'menu-card menu-card-main';

    const hero = document.createElement('div');
    hero.className = 'menu-hero';

    const crest = document.createElement('div');
    crest.className = 'menu-crest';
    crest.innerHTML = `<span>${TOWER_ICON_SVGS.archer}</span><span>${TOWER_ICON_SVGS.frost}</span><span>${TOWER_ICON_SVGS.tesla}</span>`;

    const title = document.createElement('h1');
    title.className = 'menu-title';
    title.innerHTML = '<span class="menu-title-top">Skyhold</span><span class="menu-title-bottom">Isles</span>';
    title.setAttribute('aria-label', 'Skyhold Isles');

    const subtitle = document.createElement('p');
    subtitle.className = 'menu-subtitle';
    subtitle.textContent = 'Floating isles defense';

    hero.append(crest, title, subtitle);

    const actions = document.createElement('div');
    actions.className = 'menu-actions';

    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'menu-progress-pill gx gx-slate';

    const btnStack = document.createElement('div');
    btnStack.className = 'menu-btn-stack';

    this.playBtn = document.createElement('button');
    this.playBtn.type = 'button';
    this.playBtn.className = 'btn-primary btn-lg gx gx-green';
    this.playBtn.setAttribute('data-testid', 'btn-play');
    this.playBtn.addEventListener('click', () => callbacks.onPlay(this.targetLevelIndex));

    const levelSelectBtn = document.createElement('button');
    levelSelectBtn.type = 'button';
    levelSelectBtn.className = 'btn-secondary btn-lg gx gx-slate-btn';
    levelSelectBtn.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.islands}</span><span class="btn-label">Islands</span>`;
    levelSelectBtn.setAttribute('data-testid', 'btn-level-select');
    levelSelectBtn.addEventListener('click', () => callbacks.onOpenLevelSelect());

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'btn-secondary btn-lg gx gx-slate-btn';
    settingsBtn.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.settings}</span><span class="btn-label">Settings</span>`;
    settingsBtn.setAttribute('data-testid', 'btn-main-settings');
    settingsBtn.addEventListener('click', () => callbacks.onOpenSettings());

    this.workshopBtn = document.createElement('button');
    this.workshopBtn.type = 'button';
    this.workshopBtn.className = 'btn-secondary btn-lg gx gx-slate-btn btn-workshop';
    this.workshopBtn.innerHTML = `<span class="btn-icon">${WORKSHOP_ICON_SVG}</span><span class="btn-label">Workshop</span>`;
    this.workshopBtn.setAttribute('data-testid', 'btn-workshop');
    this.workshopBtn.addEventListener('click', () => callbacks.onOpenWorkshop?.());

    settingsBtn.classList.add('menu-settings-icon');
    settingsBtn.setAttribute('aria-label', 'Settings');

    const secondary = document.createElement('div');
    secondary.className = 'menu-btn-row has-workshop';
    secondary.append(levelSelectBtn, this.workshopBtn, settingsBtn);
    btnStack.append(this.playBtn, secondary);

    const hints = document.createElement('div');
    hints.className = 'menu-controls-hint desktop-only';
    hints.textContent = 'Drag / WASD pan · Wheel zoom · Q/E rotate · 1–5 build · Space pause';

    actions.append(this.summaryEl, btnStack, hints);
    card.append(hero, actions);
    this.rootEl.appendChild(card);
    parent.appendChild(this.rootEl);
  }

  setOpen(open: boolean, progress?: ProgressData): void {
    this.rootEl.classList.toggle('hidden', !open);
    if (!open || !progress) return;

    const totalStars = progress.bestStars.reduce((a, b) => a + b, 0);
    const maxStars = LEVELS.length * 3;
    const frontierIdx = Math.max(0, Math.min(LEVELS.length - 1, progress.unlockedLevelIndex));
    this.targetLevelIndex = frontierIdx;
    const frontierLevel = LEVELS[frontierIdx];

    this.playBtn.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.play}</span><span class="btn-label-stack"><span class="btn-label">Play</span><span class="btn-sub">${frontierLevel.name}</span></span>`;
    this.summaryEl.innerHTML = `<span class="menu-star-inline">${UI_ICON_SVGS.star}</span><b>${totalStars}</b><span class="menu-stars-of">/ ${maxStars}</span>`;
    this.summaryEl.title = `${frontierIdx + 1}/${LEVELS.length} islands unlocked`;
    setWorkshopBadge(this.workshopBtn, progress);
  }

  dispose(): void {
    this.rootEl.remove();
  }
}

export interface LevelSelectCallbacks {
  onSelectLevel: (levelIndex: number) => void;
  onBack: () => void;
  onOpenWorkshop?: () => void;
  onOpenLogbook?: () => void;
}

export class LevelSelectOverlay {
  private readonly rootEl: HTMLDivElement;
  private readonly starsBadgeEl: HTMLDivElement;
  private readonly workshopBtn: HTMLButtonElement;
  private readonly gridEl: HTMLDivElement;
  private readonly callbacks: LevelSelectCallbacks;

  constructor(parent: HTMLElement, callbacks: LevelSelectCallbacks) {
    this.callbacks = callbacks;
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'menu-screen menu-screen-levels hidden ui-interactive';

    const card = document.createElement('div');
    card.className = 'menu-card level-select-card';

    const header = document.createElement('div');
    header.className = 'level-select-header';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'level-back-btn gx gx-slate-btn';
    backBtn.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.home}</span>`;
    backBtn.setAttribute('aria-label', 'Back to menu');
    backBtn.setAttribute('data-testid', 'btn-level-back');
    backBtn.addEventListener('click', () => callbacks.onBack());

    const title = document.createElement('h2');
    title.className = 'level-select-title';
    title.textContent = 'Islands';

    this.starsBadgeEl = document.createElement('div');
    this.starsBadgeEl.className = 'menu-progress-pill gx gx-slate lb-open-pill';
    this.starsBadgeEl.setAttribute('role', 'button');
    this.starsBadgeEl.tabIndex = 0;
    this.starsBadgeEl.setAttribute('aria-label', 'Open the Logbook');
    this.starsBadgeEl.setAttribute('data-testid', 'btn-logbook');
    this.starsBadgeEl.addEventListener('click', () => callbacks.onOpenLogbook?.());
    this.starsBadgeEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        callbacks.onOpenLogbook?.();
      }
    });

    this.workshopBtn = document.createElement('button');
    this.workshopBtn.type = 'button';
    this.workshopBtn.className = 'btn-secondary gx gx-slate-btn ws-entry-btn';
    this.workshopBtn.innerHTML = `<span class="btn-icon">${WORKSHOP_ICON_SVG}</span><span class="btn-label">Workshop</span>`;
    this.workshopBtn.setAttribute('aria-label', 'Workshop');
    this.workshopBtn.setAttribute('data-testid', 'btn-level-workshop');
    this.workshopBtn.addEventListener('click', () => callbacks.onOpenWorkshop?.());

    header.append(backBtn, title, this.workshopBtn, this.starsBadgeEl);

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'level-grid';

    const makeNav = (dir: -1 | 1): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `level-nav level-nav-${dir < 0 ? 'prev' : 'next'} gx gx-slate-btn`;
      btn.setAttribute('aria-label', dir < 0 ? 'Previous islands' : 'Next islands');
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${
        dir < 0 ? 'M15 5L8 12L15 19' : 'M9 5L16 12L9 19'
      }" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      btn.addEventListener('click', () => {
        this.gridEl.scrollBy({ left: dir * Math.max(240, this.gridEl.clientWidth * 0.6), behavior: 'smooth' });
      });
      return btn;
    };

    const stage = document.createElement('div');
    stage.className = 'level-stage';
    stage.append(makeNav(-1), this.gridEl, makeNav(1));

    card.append(header, stage);
    this.rootEl.appendChild(card);
    parent.appendChild(this.rootEl);
  }

  setOpen(open: boolean, progress?: ProgressData): void {
    this.rootEl.classList.toggle('hidden', !open);
    if (!open || !progress) return;

    const totalStars = progress.bestStars.reduce((a, b) => a + b, 0);
    this.starsBadgeEl.innerHTML = `<span class="menu-star-inline">${UI_ICON_SVGS.star}</span><b>${totalStars}</b><span class="menu-stars-of">/ ${LEVELS.length * 3}</span>`;
    setWorkshopBadge(this.workshopBtn, progress);

    this.gridEl.innerHTML = '';
    for (let i = 0; i < LEVELS.length; i++) {
      const lvl = LEVELS[i];
      const unlocked = i <= progress.unlockedLevelIndex;
      const stars = progress.bestStars[i] ?? 0;
      const diffClass = DIFFICULTY_CLASS[lvl.difficulty] ?? 'diff-breezy';

      const card = document.createElement('div');
      card.className = `level-card gx gx-slate${unlocked ? '' : ' locked'}`;
      card.setAttribute('data-level-index', String(i));

      const topRow = document.createElement('div');
      topRow.className = 'level-card-top';
      const numEl = document.createElement('span');
      numEl.className = 'level-index-tag';
      numEl.textContent = String(i + 1);
      const diffEl = document.createElement('span');
      diffEl.className = `difficulty-badge ${diffClass}`;
      diffEl.innerHTML = `${GEM_SVG}<span>${lvl.difficulty}</span>`;
      const offeredHere = challengesForLevel(lvl);
      const mastered = unlocked && isIslandMastered(progress, i, offeredHere);
      if (mastered) {
        card.classList.add('mastered');
        const crown = document.createElement('span');
        crown.className = 'level-mastered-crown';
        crown.title = 'Mastered: 3 stars and every challenge';
        crown.innerHTML = MASTERED_CROWN_SVG;
        topRow.append(numEl, crown, diffEl);
      } else {
        topRow.append(numEl, diffEl);
      }

      const art = document.createElement('div');
      art.className = 'level-card-art';
      art.innerHTML = islandGlyphSvg(i);
      if (!unlocked) {
        const lockEl = document.createElement('span');
        lockEl.className = 'level-card-lock';
        lockEl.innerHTML = UI_ICON_SVGS.lock;
        art.appendChild(lockEl);
      }

      const nameEl = document.createElement('div');
      nameEl.className = 'level-card-name';
      nameEl.textContent = lvl.name;

      const metaEl = document.createElement('div');
      metaEl.className = 'level-card-meta';
      metaEl.innerHTML = `<span class="level-meta-item">${UI_ICON_SVGS.wave}${lvl.waves.length}</span><span class="level-meta-item">${UI_ICON_SVGS.coin}${lvl.startingGold}</span>`;

      const starsRow = document.createElement('div');
      starsRow.className = 'star-row';
      starsRow.innerHTML = renderStarsHtml(stars);

      const bestEndless = progress.bestEndlessWaves?.[i] ?? 0;
      if (bestEndless > 0) {
        const endlessChip = document.createElement('span');
        endlessChip.className = 'level-endless-chip';
        endlessChip.innerHTML = `${UI_ICON_SVGS.autoWave}W${bestEndless}`;
        endlessChip.title = `Endless best: wave ${bestEndless}`;
        metaEl.appendChild(endlessChip);
      }

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = `level-play-btn gx ${unlocked ? 'gx-green' : 'gx-slate-btn'}`;
      actionBtn.disabled = !unlocked;
      if (unlocked) {
        actionBtn.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.play}</span><span class="btn-label">${stars > 0 ? 'Replay' : 'Play'}</span>`;
        actionBtn.addEventListener('click', () => this.callbacks.onSelectLevel(i));
      } else {
        actionBtn.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.lock}</span><span class="btn-label">Clear ${i}</span>`;
        actionBtn.title = `Clear ${LEVELS[Math.max(0, i - 1)].name} to unlock`;
      }

      const offered = offeredHere;
      const medals = document.createElement('div');
      medals.className = 'level-card-medals';
      const doneChallenges = progress.challengeClears?.[i] ?? [];
      if (unlocked && stars > 0) {
        for (const id of offered) {
          const m = document.createElement('span');
          const earned = doneChallenges.includes(id);
          m.className = `level-medal${earned ? ' earned' : ''}`;
          m.title = `${CHALLENGES[id].name}${earned ? ' — earned' : ''}`;
          medals.appendChild(m);
        }
        medals.title = `Challenges ${doneChallenges.filter((id) => offered.includes(id as ChallengeId)).length}/${offered.length}`;
      }

      card.append(topRow, art, nameEl, starsRow, medals, metaEl, actionBtn);
      this.gridEl.appendChild(card);
    }

    // Center the frontier island in the carousel.
    const target = Math.max(0, Math.min(LEVELS.length - 1, progress.unlockedLevelIndex));
    window.requestAnimationFrame(() => {
      const cardEl = this.gridEl.children[target] as HTMLElement | undefined;
      if (!cardEl) return;
      this.gridEl.scrollLeft = cardEl.offsetLeft - (this.gridEl.clientWidth - cardEl.offsetWidth) / 2;
    });
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
