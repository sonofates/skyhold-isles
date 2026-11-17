import type { ProgressData } from '../core/types.ts';
import { challengesForLevel } from '../data/challenges.ts';
import { endlessTier } from '../data/endlessMutators.ts';
import { LEVELS } from '../data/levels/index.ts';
import { isIslandMastered, summarizeProgress } from '../game/progression.ts';
import { UI_ICON_SVGS } from './icons.ts';
import { MASTERED_CROWN_SVG, renderStarsHtml } from './menus.ts';
import './styles/logbook.css';

/** Island select → tap the star total: completion summary and every island's records. */
export class LogbookModal {
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private open = false;

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

  show(progress: ProgressData): void {
    this.open = true;
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

    this.card.append(head, totals, list, foot);
  }

  dispose(): void {
    this.backdrop.remove();
  }
}
