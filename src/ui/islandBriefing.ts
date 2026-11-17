import type { ProgressData } from '../core/types.ts';
import { CHALLENGES, challengesForLevel, type ChallengeDef, type ChallengeId } from '../data/challenges.ts';
import { ENDLESS_MUTATOR_INTERVAL } from '../data/endlessMutators.ts';
import { LEVELS } from '../data/levels/index.ts';
import { describeStarGoals } from '../data/stars.ts';
import { TOWER_ICON_SVGS, UI_ICON_SVGS } from './icons.ts';
import { renderStarsHtml } from './menus.ts';
import './styles/islandBriefing.css';

export interface BriefingStartConfig {
  endless: boolean;
  challenges: ChallengeId[];
}

export interface IslandBriefingCallbacks {
  onStart: (levelIndex: number, config: BriefingStartConfig) => void;
  onClose: () => void;
  onToggleSound?: (on: boolean) => void;
}

const RULE_ICONS: Partial<Record<ChallengeId, string>> = {
  galeForce: UI_ICON_SVGS.fast,
  ironTide: UI_ICON_SVGS.heart,
  thinPurse: UI_ICON_SVGS.coin,
  glassSanctuary: UI_ICON_SVGS.heart,
  silentSkies: UI_ICON_SVGS.meteor,
};

function challengeIcon(def: ChallengeDef): string {
  if (def.bannedIcon) {
    return `<span class="ib-ban">${TOWER_ICON_SVGS[def.bannedIcon]}<span class="ib-ban-slash"></span></span>`;
  }
  return RULE_ICONS[def.id] ?? UI_ICON_SVGS.star;
}

/**
 * Island briefing (island select → Replay on a cleared island): records, star goals, mode
 * (Campaign / Endless) and challenge toggles. Uncleared islands start straight away instead.
 */
export class IslandBriefingModal {
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly callbacks: IslandBriefingCallbacks;
  private levelIndex = 0;
  private mode: 'campaign' | 'endless' = 'campaign';
  private selected = new Set<ChallengeId>();
  /** Per-island toggles remembered for this session. */
  private readonly remembered = new Map<number, { mode: 'campaign' | 'endless'; challenges: ChallengeId[] }>();
  private progress: ProgressData | null = null;
  private open = false;

  constructor(parent: HTMLElement, callbacks: IslandBriefingCallbacks) {
    this.callbacks = callbacks;
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop ib-backdrop hidden ui-interactive';
    this.backdrop.setAttribute('data-testid', 'island-briefing');
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    this.card = document.createElement('div');
    this.card.className = 'modal-card ib-card gx gx-slate';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.backdrop.appendChild(this.card);
    parent.appendChild(this.backdrop);
  }

  isOpen(): boolean {
    return this.open;
  }

  show(levelIndex: number, progress: ProgressData): void {
    this.levelIndex = levelIndex;
    this.progress = progress;
    const memo = this.remembered.get(levelIndex);
    this.mode = memo?.mode ?? 'campaign';
    this.selected = new Set(memo?.challenges ?? []);
    this.open = true;
    this.render();
    this.backdrop.classList.remove('hidden');
  }

  close(): void {
    if (!this.open) return;
    this.hide();
    this.callbacks.onClose();
  }

  hide(): void {
    this.open = false;
    this.backdrop.classList.add('hidden');
  }

  private remember(): void {
    this.remembered.set(this.levelIndex, { mode: this.mode, challenges: [...this.selected] });
  }

  private render(): void {
    const progress = this.progress;
    if (!progress) return;
    const i = this.levelIndex;
    const level = LEVELS[i];
    const stars = progress.bestStars[i] ?? 0;
    const bestLives = progress.bestLives[i] ?? 0;
    const clears = progress.clears[i] ?? 0;
    const bestEndless = progress.bestEndlessWaves[i] ?? 0;
    const done = new Set(progress.challengeClears[i] ?? []);
    const offered = challengesForLevel(level);
    const goals = describeStarGoals(level.difficulty);

    this.card.innerHTML = '';

    const top = document.createElement('div');
    top.className = 'ib-top';
    top.innerHTML = `<span class="level-index-tag">${i + 1}</span><span class="ib-diff">${level.difficulty}</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ib-close gx gx-slate-btn';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.setAttribute('data-testid', 'btn-briefing-close');
    closeBtn.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.close}</span>`;
    closeBtn.addEventListener('click', () => this.close());
    top.appendChild(closeBtn);

    const title = document.createElement('div');
    title.className = 'ib-title';
    title.textContent = level.name;

    const records = document.createElement('div');
    records.className = 'ib-records';
    records.innerHTML = `
      <div class="ib-rec ib-rec-stars"><div class="star-row">${renderStarsHtml(stars)}</div><span>${stars === 3 ? 'Perfect' : `3★: ${goals.three}`}</span></div>
      <div class="ib-rec"><strong>${bestLives > 0 ? `${bestLives}` : '–'}</strong><span>best lives</span></div>
      <div class="ib-rec"><strong>${clears}×</strong><span>won</span></div>
      <div class="ib-rec"><strong>${bestEndless > 0 ? `W${bestEndless}` : '–'}</strong><span>endless</span></div>`;

    const modes = document.createElement('div');
    modes.className = 'ib-modes';
    const makeMode = (id: 'campaign' | 'endless', label: string, icon: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ib-mode gx gx-slate-btn${this.mode === id ? ' active' : ''}`;
      b.setAttribute('aria-pressed', this.mode === id ? 'true' : 'false');
      b.setAttribute('data-testid', `btn-briefing-mode-${id}`);
      b.innerHTML = `<span class="btn-icon">${icon}</span><span class="btn-label">${label}</span>`;
      b.addEventListener('click', () => {
        if (this.mode === id) return;
        this.mode = id;
        this.remember();
        this.render();
      });
      return b;
    };
    modes.append(makeMode('campaign', 'Campaign', UI_ICON_SVGS.play), makeMode('endless', 'Endless', UI_ICON_SVGS.autoWave));

    const body = document.createElement('div');
    body.className = 'ib-body';
    if (this.mode === 'campaign') {
      const head = document.createElement('div');
      head.className = 'ib-section-head';
      head.innerHTML = `<span>Challenges</span><b>${done.size}/${offered.length}</b>`;
      body.appendChild(head);
      for (const id of offered) body.appendChild(this.renderChallenge(CHALLENGES[id], done.has(id)));
      const note = document.createElement('div');
      note.className = 'ib-note';
      note.textContent = 'Win with a challenge on for its badge and +1★. Stars and unlocks still count.';
      body.appendChild(note);
    } else {
      const info = document.createElement('div');
      info.className = 'ib-endless-info';
      info.innerHTML = `<p>Play the island's waves, then generated waves forever. Bosses every 5 waves; a new <b>mutator</b> joins every ${ENDLESS_MUTATOR_INTERVAL} endless waves and they stack.</p><p>${
        bestEndless > 0 ? `Your best: <b>wave ${bestEndless}</b>.` : 'No endless record yet.'
      } Endless runs don't award stars.</p>`;
      body.appendChild(info);
    }

    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn-primary btn-lg gx gx-green ib-start';
    start.setAttribute('data-testid', 'btn-briefing-start');
    const nSel = this.selected.size;
    const label =
      this.mode === 'endless' ? 'Start Endless' : nSel > 0 ? `Start challenge` : clears > 0 ? 'Replay' : 'Play';
    const sub =
      this.mode === 'campaign' && nSel > 0
        ? `<span class="ib-start-sub">${[...this.selected].map((id) => CHALLENGES[id].name).join(' + ')}</span>`
        : '';
    start.innerHTML = `<span class="btn-icon">${this.mode === 'endless' ? UI_ICON_SVGS.autoWave : UI_ICON_SVGS.play}</span><span class="btn-label-stack ib-start-stack"><span class="btn-label">${label}</span>${sub}</span>`;
    start.addEventListener('click', () => {
      this.remember();
      this.hide();
      this.callbacks.onStart(this.levelIndex, {
        endless: this.mode === 'endless',
        challenges: this.mode === 'campaign' ? offered.filter((id) => this.selected.has(id)) : [],
      });
    });

    this.card.append(top, title, records, modes, body, start);
  }

  private renderChallenge(def: ChallengeDef, earned: boolean): HTMLElement {
    const on = this.selected.has(def.id);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `ib-challenge${on ? ' on' : ''}${earned ? ' earned' : ''}`;
    row.setAttribute('role', 'switch');
    row.setAttribute('aria-checked', on ? 'true' : 'false');
    row.setAttribute('data-testid', `btn-challenge-${def.id}`);
    row.innerHTML = `
      <span class="ib-ch-icon">${challengeIcon(def)}</span>
      <span class="ib-ch-text"><span class="ib-ch-name">${def.name}${
        earned ? ` <span class="ib-ch-badge">${UI_ICON_SVGS.star}Earned</span>` : ' <span class="ib-ch-reward">+1★</span>'
      }</span><span class="ib-ch-desc">${def.description}</span></span>
      <span class="ib-switch" aria-hidden="true"></span>`;
    row.addEventListener('click', () => {
      if (this.selected.has(def.id)) this.selected.delete(def.id);
      else this.selected.add(def.id);
      this.callbacks.onToggleSound?.(this.selected.has(def.id));
      this.remember();
      this.render();
    });
    return row;
  }

  dispose(): void {
    this.backdrop.remove();
  }
}
