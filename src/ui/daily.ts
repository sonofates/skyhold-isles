import type { ProgressData } from '../core/types.ts';
import { CHALLENGES } from '../data/challenges.ts';
import { liveStreak, utcDayNumber, type DailyChallenge } from '../data/daily.ts';
import { LEVELS } from '../data/levels/index.ts';
import { UI_ICON_SVGS } from './icons.ts';
import { challengeIcon } from './islandBriefing.ts';
import './styles/daily.css';

/** Sun-and-cloud glyph for the Daily Squall entry. */
export const DAILY_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="4.6" fill="#f6bd41" stroke="#1b1936" stroke-width="1.8"/><path d="M7 19.5H17.5C19.7 19.5 21 18 21 16.3C21 14.5 19.6 13.1 17.8 13.2C17.2 11.2 15.4 10 13.4 10.2C11.3 10.4 9.7 12 9.6 14C8 13.9 6.2 15.1 6.2 16.9C6.2 18.2 6.6 19.5 7 19.5Z" fill="#f8f4e8" stroke="#1b1936" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

export interface DailyCallbacks {
  onStart: () => void;
}

function formatUtcDay(day: number): string {
  const d = new Date(day * 86_400_000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Daily Squall card: today's island + two fixed challenges, streak and reward. */
export class DailyModal {
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly callbacks: DailyCallbacks;
  private open = false;

  constructor(parent: HTMLElement, callbacks: DailyCallbacks) {
    this.callbacks = callbacks;
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop hidden ui-interactive';
    this.backdrop.setAttribute('data-testid', 'daily-modal');
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.hide();
    });
    this.card = document.createElement('div');
    this.card.className = 'modal-card ib-card dl-card gx gx-slate';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-label', 'Daily Squall');
    this.backdrop.appendChild(this.card);
    parent.appendChild(this.backdrop);
  }

  isOpen(): boolean {
    return this.open;
  }

  hide(): void {
    this.open = false;
    this.backdrop.classList.add('hidden');
  }

  show(daily: DailyChallenge | null, progress: ProgressData): void {
    this.open = true;
    this.render(daily, progress);
    this.backdrop.classList.remove('hidden');
  }

  private render(daily: DailyChallenge | null, progress: ProgressData): void {
    this.card.innerHTML = '';
    const top = document.createElement('div');
    top.className = 'ib-top';
    top.innerHTML = `<span class="dl-icon">${DAILY_ICON_SVG}</span><span class="ib-diff">${
      daily ? `${formatUtcDay(daily.day)} · UTC` : 'Daily'
    }</span>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ib-close gx gx-slate-btn';
    close.setAttribute('aria-label', 'Close');
    close.setAttribute('data-testid', 'btn-daily-close');
    close.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.close}</span>`;
    close.addEventListener('click', () => this.hide());
    top.appendChild(close);

    const title = document.createElement('div');
    title.className = 'ib-title';
    title.textContent = 'Daily Squall';

    if (!daily) {
      const empty = document.createElement('div');
      empty.className = 'ib-endless-info';
      empty.innerHTML = '<p>Clear your first island to unlock the Daily Squall: one island and two challenges, new every day.</p>';
      this.card.append(top, title, empty);
      return;
    }

    const level = LEVELS[daily.levelIndex];
    const today = daily.day;
    const doneToday = progress.daily.lastDay >= today;
    const streak = liveStreak(progress.daily, today);

    const island = document.createElement('div');
    island.className = 'dl-island';
    island.innerHTML = `<span class="level-index-tag">${daily.levelIndex + 1}</span><span class="dl-island-name">${level.name}<small>${level.difficulty}</small></span>`;

    const list = document.createElement('div');
    list.className = 'ib-body';
    for (const id of daily.challenges) {
      const def = CHALLENGES[id];
      const row = document.createElement('div');
      row.className = 'ib-challenge on dl-challenge';
      row.innerHTML = `<span class="ib-ch-icon">${challengeIcon(def)}</span><span class="ib-ch-text"><span class="ib-ch-name">${def.name}</span><span class="ib-ch-desc">${def.description}</span></span>`;
      list.appendChild(row);
    }

    const stats = document.createElement('div');
    stats.className = 'ib-records dl-stats';
    stats.innerHTML = `
      <div class="ib-rec"><strong>${doneToday ? '✓' : '+1★'}</strong><span>${doneToday ? 'won today' : 'reward'}</span></div>
      <div class="ib-rec"><strong>${streak}</strong><span>day streak</span></div>
      <div class="ib-rec"><strong>${progress.daily.bestStreak}</strong><span>best streak</span></div>
      <div class="ib-rec"><strong>${progress.daily.total}</strong><span>won</span></div>`;

    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn-primary btn-lg gx gx-green ib-start';
    start.setAttribute('data-testid', 'btn-daily-start');
    start.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.play}</span><span class="btn-label-stack ib-start-stack"><span class="btn-label">${
      doneToday ? 'Play again' : 'Start'
    }</span><span class="ib-start-sub">${doneToday ? 'No reward until tomorrow' : 'Win once today for +1★'}</span></span>`;
    start.addEventListener('click', () => {
      this.hide();
      this.callbacks.onStart();
    });

    this.card.append(top, title, island, stats, list, start);
  }

  dispose(): void {
    this.backdrop.remove();
  }
}

/** Main menu pill state: is today's daily still open? */
export function dailyPillState(progress: ProgressData, nowMs: number): { open: boolean; streak: number } {
  const today = utcDayNumber(nowMs);
  return { open: progress.daily.lastDay < today, streak: liveStreak(progress.daily, today) };
}
