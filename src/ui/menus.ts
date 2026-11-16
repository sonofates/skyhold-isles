import type { ProgressData } from '../core/types.ts';
import { LEVELS } from '../data/levels/index.ts';
import { TOWER_ICON_SVGS, UI_ICON_SVGS } from './icons.ts';

export function renderStarsHtml(earned: number): string {
  let out = '';
  for (let i = 1; i <= 3; i++) {
    out += `<span class="star-slot ${i <= earned ? 'earned' : 'empty'}">${
      i <= earned ? UI_ICON_SVGS.star : UI_ICON_SVGS.starEmpty
    }</span>`;
  }
  return out;
}

export interface MainMenuCallbacks {
  onPlay: (levelIndex: number) => void;
  onOpenLevelSelect: () => void;
  onOpenSettings: () => void;
}

export class MainMenuOverlay {
  private readonly rootEl: HTMLDivElement;
  private readonly summaryEl: HTMLDivElement;
  private readonly playBtn: HTMLButtonElement;
  private targetLevelIndex = 0;

  constructor(parent: HTMLElement, callbacks: MainMenuCallbacks) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'menu-screen hidden ui-interactive';

    const card = document.createElement('div');
    card.className = 'menu-card';

    const crest = document.createElement('div');
    crest.className = 'menu-crest';
    crest.innerHTML = `${TOWER_ICON_SVGS.archer}${UI_ICON_SVGS.wave}${TOWER_ICON_SVGS.frost}`;

    const badge = document.createElement('div');
    badge.className = 'menu-badge';
    badge.textContent = 'FLOATING ISLES DEFENSE';

    const title = document.createElement('h1');
    title.className = 'menu-title';
    title.textContent = 'Skyhold Isles';

    const subtitle = document.createElement('p');
    subtitle.className = 'menu-subtitle';
    subtitle.textContent =
      'Command modular spires across sunlit floating archipelagos and guard the ancient sanctuary.';

    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'menu-progress-pill';

    const btnStack = document.createElement('div');
    btnStack.className = 'menu-btn-stack';

    this.playBtn = document.createElement('button');
    this.playBtn.type = 'button';
    this.playBtn.className = 'btn-primary btn-lg';
    this.playBtn.setAttribute('data-testid', 'btn-play');
    this.playBtn.addEventListener('click', () => callbacks.onPlay(this.targetLevelIndex));

    const levelSelectBtn = document.createElement('button');
    levelSelectBtn.type = 'button';
    levelSelectBtn.className = 'btn-secondary btn-lg';
    levelSelectBtn.textContent = 'Level Select';
    levelSelectBtn.setAttribute('data-testid', 'btn-level-select');
    levelSelectBtn.addEventListener('click', () => callbacks.onOpenLevelSelect());

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'btn-secondary btn-lg';
    settingsBtn.textContent = 'Settings';
    settingsBtn.setAttribute('data-testid', 'btn-main-settings');
    settingsBtn.addEventListener('click', () => callbacks.onOpenSettings());

    btnStack.append(this.playBtn, levelSelectBtn, settingsBtn);

    const hints = document.createElement('div');
    hints.className = 'menu-controls-hint';
    hints.textContent =
      'Drag / WASD: Pan · Wheel / Pinch: Zoom · Q/E: Rotate · 1–5: Build · Space: Pause';

    card.append(crest, badge, title, subtitle, this.summaryEl, btnStack, hints);
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

    this.playBtn.textContent = `Play · ${frontierLevel.name}`;
    this.summaryEl.innerHTML = `<span class="menu-star-inline">${UI_ICON_SVGS.star}</span><span>${totalStars} / ${maxStars} Stars · ${frontierIdx + 1}/${LEVELS.length} Islands Unlocked</span>`;
  }

  dispose(): void {
    this.rootEl.remove();
  }
}

export interface LevelSelectCallbacks {
  onSelectLevel: (levelIndex: number) => void;
  onBack: () => void;
}

export class LevelSelectOverlay {
  private readonly rootEl: HTMLDivElement;
  private readonly starsBadgeEl: HTMLDivElement;
  private readonly gridEl: HTMLDivElement;
  private readonly callbacks: LevelSelectCallbacks;

  constructor(parent: HTMLElement, callbacks: LevelSelectCallbacks) {
    this.callbacks = callbacks;
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'menu-screen hidden ui-interactive';

    const card = document.createElement('div');
    card.className = 'menu-card level-select-card';

    const header = document.createElement('div');
    header.className = 'level-select-header';

    const titleWrap = document.createElement('div');
    const title = document.createElement('h2');
    title.className = 'level-select-title';
    title.textContent = 'Select Island';
    const sub = document.createElement('div');
    sub.className = 'level-select-sub';
    sub.textContent = 'Clear each island to unlock the next skyward citadel';
    titleWrap.append(title, sub);

    this.starsBadgeEl = document.createElement('div');
    this.starsBadgeEl.className = 'menu-progress-pill';

    header.append(titleWrap, this.starsBadgeEl);

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'level-grid';

    const footer = document.createElement('div');
    footer.className = 'level-select-footer';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'btn-secondary';
    backBtn.textContent = 'Back to Menu';
    backBtn.setAttribute('data-testid', 'btn-level-back');
    backBtn.addEventListener('click', () => callbacks.onBack());
    footer.appendChild(backBtn);

    card.append(header, this.gridEl, footer);
    this.rootEl.appendChild(card);
    parent.appendChild(this.rootEl);
  }

  setOpen(open: boolean, progress?: ProgressData): void {
    this.rootEl.classList.toggle('hidden', !open);
    if (!open || !progress) return;

    const totalStars = progress.bestStars.reduce((a, b) => a + b, 0);
    this.starsBadgeEl.innerHTML = `<span class="menu-star-inline">${UI_ICON_SVGS.star}</span><span>${totalStars} / ${LEVELS.length * 3} Stars</span>`;

    this.gridEl.innerHTML = '';
    for (let i = 0; i < LEVELS.length; i++) {
      const lvl = LEVELS[i];
      const unlocked = i <= progress.unlockedLevelIndex;
      const stars = progress.bestStars[i] ?? 0;

      const card = document.createElement('div');
      card.className = `level-card${unlocked ? '' : ' locked'}`;
      card.setAttribute('data-level-index', String(i));

      const topRow = document.createElement('div');
      topRow.className = 'level-card-top';
      const numEl = document.createElement('span');
      numEl.className = 'level-index-tag';
      numEl.textContent = `Island ${i + 1}`;

      const diffEl = document.createElement('span');
      diffEl.className = `difficulty-badge diff-${lvl.difficulty.toLowerCase()}`;
      diffEl.textContent = lvl.difficulty;
      topRow.append(numEl, diffEl);

      const nameEl = document.createElement('div');
      nameEl.className = 'level-card-name';
      nameEl.textContent = lvl.name;

      const descEl = document.createElement('div');
      descEl.className = 'level-card-desc';
      descEl.textContent = lvl.subtitle;

      const metaEl = document.createElement('div');
      metaEl.className = 'level-card-meta';
      metaEl.textContent = `${lvl.waves.length} Waves · ${lvl.startingGold}g`;

      const starsRow = document.createElement('div');
      starsRow.className = 'star-row';
      starsRow.innerHTML = renderStarsHtml(stars);

      const bestEndless = progress.bestEndlessWaves?.[i] ?? 0;
      if (bestEndless > 0) {
        const endlessChip = document.createElement('span');
        endlessChip.className = 'level-endless-chip';
        endlessChip.textContent = `Endless: W${bestEndless}`;
        endlessChip.style.marginLeft = 'auto';
        endlessChip.style.padding = '2px 8px';
        endlessChip.style.borderRadius = '999px';
        endlessChip.style.fontSize = '10.5px';
        endlessChip.style.fontWeight = '800';
        endlessChip.style.fontFamily = 'var(--font-mono)';
        endlessChip.style.background = 'rgba(79, 179, 217, 0.18)';
        endlessChip.style.border = '1px solid rgba(79, 179, 217, 0.45)';
        endlessChip.style.color = '#1e627e';
        starsRow.appendChild(endlessChip);
      }

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = unlocked ? 'btn-primary level-play-btn' : 'btn-secondary level-play-btn';
      actionBtn.disabled = !unlocked;
      actionBtn.textContent = unlocked
        ? stars > 0
          ? 'Replay Island'
          : 'Deploy'
        : `Locked · Clear ${LEVELS[Math.max(0, i - 1)].name}`;
      if (unlocked) {
        actionBtn.addEventListener('click', () => this.callbacks.onSelectLevel(i));
      }

      card.append(topRow, nameEl, descEl, metaEl, starsRow, actionBtn);
      this.gridEl.appendChild(card);
    }
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
