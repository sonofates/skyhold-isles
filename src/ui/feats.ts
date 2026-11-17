import type { ProgressData } from '../core/types.ts';
import { featStatuses, type FeatDef, type FeatIcon } from '../game/feats.ts';
import { DAILY_ICON_SVG } from './daily.ts';
import { UI_ICON_SVGS } from './icons.ts';
import { MASTERED_CROWN_SVG } from './menus.ts';
import './styles/feats.css';

const TROPHY_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4H17V9.5C17 12.5 14.8 14.6 12 14.6C9.2 14.6 7 12.5 7 9.5V4Z" fill="#f6bd41" stroke="#1b1936" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 6H4.2C4.2 8.6 5.4 10.2 7.4 10.6M17 6H19.8C19.8 8.6 18.6 10.2 16.6 10.6" stroke="#1b1936" stroke-width="1.8" stroke-linecap="round"/><path d="M10.2 14.4L9.6 17.6H14.4L13.8 14.4" fill="#d99a2b" stroke="#1b1936" stroke-width="1.6" stroke-linejoin="round"/><rect x="7.6" y="17.6" width="8.8" height="3" rx="0.6" fill="#8a6cd6" stroke="#1b1936" stroke-width="1.6"/></svg>`;

/** Icon markup per feat icon (the medal is a CSS diamond like the island cards'). */
export function featIconHtml(icon: FeatIcon): string {
  switch (icon) {
    case 'star':
      return UI_ICON_SVGS.star;
    case 'islands':
      return UI_ICON_SVGS.islands;
    case 'medal':
      return '<span class="ft-medal"></span>';
    case 'crown':
      return MASTERED_CROWN_SVG;
    case 'endless':
      return UI_ICON_SVGS.autoWave;
    case 'daily':
      return DAILY_ICON_SVG;
    case 'trophy':
      return TROPHY_SVG;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Results-card chips for newly earned feats, revealed one after another from `startDelayMs`. */
export function featCalloutChips(feats: readonly FeatDef[], startDelayMs: number): string[] {
  return feats.map(
    (f, k) =>
      `<span class="outcome-callout callout-feat" style="--reveal-delay:${startDelayMs + k * 160}ms">${featIconHtml(f.icon)}<span>Feat: <b>${escapeHtml(f.name)}</b></span></span>`,
  );
}

/** "Feats" tab of the Logbook: one row per feat with progress, earned ones first-class. */
export function renderFeatsList(progress: ProgressData): { el: HTMLDivElement; earned: number; total: number } {
  const statuses = featStatuses(progress);
  const el = document.createElement('div');
  el.className = 'lb-list ft-list';
  el.setAttribute('data-testid', 'feats-list');
  let earned = 0;
  for (const s of statuses) {
    if (s.earned) earned++;
    const row = document.createElement('div');
    row.className = `ft-row${s.earned ? ' earned' : ''}`;
    const pct = Math.round((s.current / s.target) * 100);
    const right = s.earned
      ? `<span class="ft-done" aria-label="Earned">${UI_ICON_SVGS.star}</span>`
      : s.target > 1
        ? `<span class="ft-progress"><b>${s.current}</b>/${s.target}<i style="--p:${pct}%"></i></span>`
        : '<span class="ft-progress ft-progress-todo">–</span>';
    row.innerHTML = `<span class="ft-icon">${featIconHtml(s.def.icon)}</span>
      <span class="ft-text"><strong>${s.def.name}</strong><small>${s.def.description}</small></span>
      ${right}`;
    el.appendChild(row);
  }
  return { el, earned, total: statuses.length };
}
