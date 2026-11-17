import type { ProgressData } from '../core/types.ts';
import { challengesForLevel } from '../data/challenges.ts';
import { endlessTier } from '../data/endlessMutators.ts';
import { LEVELS } from '../data/levels/index.ts';
import { isIslandMastered, summarizeProgress } from '../game/progression.ts';
import { UI_ICON_SVGS } from './icons.ts';
import { MASTERED_CROWN_SVG, renderStarsHtml } from './menus.ts';
import { renderFeatsList } from './feats.ts';
import './styles/logbook.css';

type LogbookTab = 'islands' | 'feats';

/** Island select → tap the star total: completion summary, every island's records and feats. */
export class LogbookModal {
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private open = false;
  private tab: LogbookTab = 'islands';

  constructor(parent: HTMLElement) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop lb-backdrop hidden ui-interactive';
    this.backdrop.setAttribute('data-testid', 'logbook');
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.hide();
    });
    this.card = document.createElement('div');
    this.card.className = 'modal-card lb-card gx gx-slate';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-label', 'Logbook');
    this.backdrop.appendChild(this.card);
    parent.appendChild(this.backdrop);
  }

  isOpen(): boolean {
    return this.open;
  }

  show(progress: ProgressData, tab: LogbookTab = 'islands'): void {
    this.open = true;
    this.tab = tab;
    this.render(progress);
    this.backdrop.classList.remove('hidden');
    // Keyboard users land on the main action (no scroll jump on touch).
    this.card.querySelector<HTMLElement>('.lb-close')?.focus({ preventScroll: true });
  }

  hide(): void {
    this.open = false;
    this.backdrop.classList.add('hidden');
  }

  private render(progress: ProgressData): void {
    const sum = summarizeProgress(progress);
    this.card.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'lb-head';
    const title = document.createElement('div');
    title.className = 'lb-title';
    title.textContent = 'Logbook';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ib-close lb-close gx gx-slate-btn';
    close.setAttribute('aria-label', 'Close');
    close.setAttribute('data-testid', 'btn-logbook-close');
    close.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.close}</span>`;
    close.addEventListener('click', () => this.hide());
    head.append(title, close);

    const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 100) : 0);
    const totals = document.createElement('div');
    totals.className = 'lb-totals';
    totals.innerHTML = `
      <div class="lb-total"><span class="lb-total-icon">${UI_ICON_SVGS.star}</span><strong>${sum.campaignStars}<small>/${sum.campaignMax}</small></strong><span>stars</span><i style="--p:${pct(sum.campaignStars, sum.campaignMax)}%"></i></div>
      <div class="lb-total"><span class="lb-total-icon lb-medal-icon"></span><strong>${sum.badges}<small>/${sum.badgesMax}</small></strong><span>badges</span><i style="--p:${pct(sum.badges, sum.badgesMax)}%"></i></div>
      <div class="lb-total"><span class="lb-total-icon">${MASTERED_CROWN_SVG}</span><strong>${sum.mastered}<small>/${sum.islands}</small></strong><span>mastered</span><i style="--p:${pct(sum.mastered, sum.islands)}%"></i></div>
      <div class="lb-total"><span class="lb-total-icon">${UI_ICON_SVGS.autoWave}</span><strong>${sum.bestEndless > 0 ? `W${sum.bestEndless}` : '–'}</strong><span>${sum.bestEndlessIsland ? 'best endless' : 'no endless yet'}</span></div>`;

    const feats = renderFeatsList(progress);
    const tabs = document.createElement('div');
    tabs.className = 'lb-tabs';
    tabs.setAttribute('role', 'tablist');
    const makeTab = (tab: LogbookTab, html: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `lb-tab${this.tab === tab ? ' active' : ''}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(this.tab === tab));
      b.setAttribute('data-testid', `logbook-tab-${tab}`);
      b.innerHTML = html;
      b.tabIndex = this.tab === tab ? 0 : -1;
      b.addEventListener('click', () => select(tab));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          select(this.tab === 'islands' ? 'feats' : 'islands');
        }
      });
      return b;
    };
    const select = (tab: LogbookTab): void => {
      if (this.tab === tab) return;
      this.tab = tab;
      this.render(progress);
      this.card.querySelector<HTMLElement>(`[data-testid="logbook-tab-${tab}"]`)?.focus({ preventScroll: true });
    };
    tabs.append(
      makeTab('islands', 'Islands'),
      makeTab('feats', `Feats <small>${feats.earned}/${feats.total}</small>`),
    );

    const list = document.createElement('div');
    list.className = 'lb-list';
    for (let i = 0; i < LEVELS.length; i++) {
      const level = LEVELS[i];
      const unlocked = i <= progress.unlockedLevelIndex;
      const offered = challengesForLevel(level);
      const done = progress.challengeClears[i] ?? [];
      const row = document.createElement('div');
      const mastered = isIslandMastered(progress, i, offered);
      row.className = `lb-row${unlocked ? '' : ' locked'}${mastered ? ' mastered' : ''}`;
      const medals = offered
        .map((id) => `<span class="level-medal${done.includes(id) ? ' earned' : ''}"></span>`)
        .join('');
      const lives = progress.bestLives[i] ?? 0;
      const wins = progress.clears[i] ?? 0;
      const endless = progress.bestEndlessWaves[i] ?? 0;
      row.innerHTML = unlocked
        ? `<span class="lb-num">${i + 1}</span>
           <span class="lb-name"><span class="lb-name-main">${level.name}${mastered ? `<span class="lb-crown">${MASTERED_CROWN_SVG}</span>` : ''}</span><small>${level.difficulty}</small></span>
           <span class="lb-stars star-row">${renderStarsHtml(progress.bestStars[i] ?? 0)}</span>
           <span class="lb-medals">${medals}</span>
           <span class="lb-stat" title="Best lives left">${lives > 0 ? `${UI_ICON_SVGS.heart}${lives}` : '–'}</span>
           <span class="lb-stat lb-stat-wins" title="Wins">${wins > 0 ? `${wins}×` : '–'}</span>
           <span class="lb-stat lb-stat-endless tier-${endlessTier(endless, level.waves.length)}" title="Endless best">${endless > 0 ? `W${endless}` : '–'}</span>`
        : `<span class="lb-num">${i + 1}</span><span class="lb-name lb-locked-name">${UI_ICON_SVGS.lock}Locked</span>`;
      list.appendChild(row);
    }

    const foot = document.createElement('div');
    foot.className = 'lb-foot';
    foot.textContent =
      sum.totalWins === 0
        ? 'Your victories, badges and records will be written here.'
        : `${sum.cleared}/${sum.islands} islands cleared · ${sum.totalWins} victories in total`;

    if (this.tab === 'feats') {
      foot.textContent =
        feats.earned === 0
          ? 'Feats are long-term goals — they unlock as your records grow.'
          : `${feats.earned} of ${feats.total} feats earned`;
    }
    this.card.append(head, tabs, totals, this.tab === 'feats' ? feats.el : list, foot);
  }

  dispose(): void {
    this.backdrop.remove();
  }
}
