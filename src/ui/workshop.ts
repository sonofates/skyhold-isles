import type { ProgressData } from '../core/types.ts';
import {
  maxRank,
  nextRankCost,
  rankOf,
  WORKSHOP_BRANCHES,
  WORKSHOP_UPGRADES,
  workshopTotalCost,
  type WorkshopUpgradeDef,
  type WorkshopUpgradeId,
} from '../data/workshop.ts';
import { starWallet } from '../game/progression.ts';
import { TOWER_ICON_SVGS, UI_ICON_SVGS } from './icons.ts';
import './styles/workshop.css';

/** Anvil glyph for the Workshop entry buttons. */
export const WORKSHOP_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7H15C15 9.5 17 10.5 21 10.5V12C17.5 12 16 13 15.5 14.5H8.5C8 12.5 6 11 3 10.5V7Z" fill="currentColor" stroke="#1b1936" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 14.5V17H6.5V20H17.5V17H15V14.5" fill="currentColor" stroke="#1b1936" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

const CHEST_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10C4 6.5 6.5 5 12 5C17.5 5 20 6.5 20 10V19H4V10Z" fill="#c98a4b" stroke="#1b1936" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 11H20" stroke="#1b1936" stroke-width="1.8"/><rect x="10" y="9.5" width="4" height="4.5" rx="0.8" fill="#f6bd41" stroke="#1b1936" stroke-width="1.6"/></svg>`;

const BAG_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4H15L13.5 7.5C17.5 9 19.5 12.5 19.5 15.5C19.5 18.8 16.5 20.5 12 20.5C7.5 20.5 4.5 18.8 4.5 15.5C4.5 12.5 6.5 9 10.5 7.5L9 4Z" fill="#e6cfa3" stroke="#1b1936" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="14.5" r="3" fill="#f6bd41" stroke="#1b1936" stroke-width="1.6"/></svg>`;

function upgradeIcon(def: WorkshopUpgradeDef): string {
  if (def.towers && def.towers.length > 0) {
    return `<span class="ws-icon-pair">${def.towers.map((t) => `<span>${TOWER_ICON_SVGS[t]}</span>`).join('')}</span>`;
  }
  switch (def.id) {
    case 'treasury':
      return CHEST_SVG;
    case 'bounty':
      return BAG_SVG;
    case 'bastion':
      return UI_ICON_SVGS.heart;
    case 'quickcast':
      return UI_ICON_SVGS.meteor;
    default:
      return UI_ICON_SVGS.star;
  }
}

export interface WorkshopCallbacks {
  onBuy: (id: WorkshopUpgradeId) => boolean;
  onRefundAll: () => void;
  onBack: () => void;
}

/** Star-funded permanent upgrades screen (main menu / island select → Workshop). */
export class WorkshopOverlay {
  private readonly rootEl: HTMLDivElement;
  private readonly walletEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly footNoteEl: HTMLDivElement;
  private readonly refundBtn: HTMLButtonElement;
  private readonly callbacks: WorkshopCallbacks;
  private progress: ProgressData | null = null;
  private refundArmedUntil = 0;
  private refundTimer = 0;
  private enterTimer = 0;
  private lastBought: WorkshopUpgradeId | null = null;

  constructor(parent: HTMLElement, callbacks: WorkshopCallbacks) {
    this.callbacks = callbacks;
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'menu-screen menu-screen-levels ws-screen hidden ui-interactive';
    this.rootEl.setAttribute('data-testid', 'workshop-screen');

    const card = document.createElement('div');
    card.className = 'menu-card ws-card';

    const header = document.createElement('div');
    header.className = 'level-select-header ws-header';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'level-back-btn gx gx-slate-btn';
    backBtn.innerHTML = `<span class="btn-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 5L8 12L15 19" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
    backBtn.setAttribute('aria-label', 'Back');
    backBtn.setAttribute('data-testid', 'btn-workshop-back');
    backBtn.addEventListener('click', () => callbacks.onBack());

    const titleWrap = document.createElement('div');
    titleWrap.className = 'ws-title-wrap';
    const title = document.createElement('h2');
    title.className = 'level-select-title ws-title';
    title.textContent = 'Workshop';
    const sub = document.createElement('div');
    sub.className = 'ws-subtitle';
    sub.textContent = 'Spend stars on lasting boosts · refund anytime';
    titleWrap.append(title, sub);

    this.walletEl = document.createElement('div');
    this.walletEl.className = 'menu-progress-pill gx gx-slate ws-wallet';
    this.walletEl.setAttribute('data-testid', 'workshop-wallet');

    header.append(backBtn, titleWrap, this.walletEl);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'ws-body';

    const footer = document.createElement('div');
    footer.className = 'ws-footer';
    this.footNoteEl = document.createElement('div');
    this.footNoteEl.className = 'ws-footnote';
    this.refundBtn = document.createElement('button');
    this.refundBtn.type = 'button';
    this.refundBtn.className = 'btn-secondary gx gx-slate-btn ws-refund';
    this.refundBtn.setAttribute('data-testid', 'btn-workshop-refund');
    this.refundBtn.addEventListener('click', () => this.onRefundClick());
    footer.append(this.footNoteEl, this.refundBtn);

    card.append(header, this.bodyEl, footer);
    this.rootEl.appendChild(card);
    parent.appendChild(this.rootEl);
  }

  isOpen(): boolean {
    return !this.rootEl.classList.contains('hidden');
  }

  setOpen(open: boolean, progress?: ProgressData): void {
    this.rootEl.classList.toggle('hidden', !open);
    this.disarmRefund();
    if (!open) {
      this.lastBought = null;
      return;
    }
    if (progress) this.progress = progress;
    this.render();
    this.bodyEl.scrollTop = 0;
    // Staggered entrance only when the screen opens, not on every purchase re-render.
    this.bodyEl.classList.add('ws-entering');
    window.clearTimeout(this.enterTimer);
    this.enterTimer = window.setTimeout(() => this.bodyEl.classList.remove('ws-entering'), 500);
  }

  private onRefundClick(): void {
    if (!this.progress) return;
    if (Object.keys(this.progress.workshop).length === 0) return;
    if (performance.now() < this.refundArmedUntil) {
      this.disarmRefund();
      this.callbacks.onRefundAll();
      this.lastBought = null;
      this.render();
      return;
    }
    this.refundArmedUntil = performance.now() + 3200;
    this.refundBtn.classList.add('armed');
    this.renderRefundLabel();
    window.clearTimeout(this.refundTimer);
    this.refundTimer = window.setTimeout(() => {
      this.disarmRefund();
      this.renderRefundLabel();
    }, 3200);
  }

  private disarmRefund(): void {
    this.refundArmedUntil = 0;
    window.clearTimeout(this.refundTimer);
    this.refundBtn.classList.remove('armed');
  }

  private renderRefundLabel(): void {
    const armed = this.refundBtn.classList.contains('armed');
    const spent = this.progress ? starWallet(this.progress).spent : 0;
    this.refundBtn.disabled = spent === 0;
    this.refundBtn.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.restart}</span><span class="btn-label">${
      armed ? `Tap again · refund ${spent}★` : 'Refund all'
    }</span>`;
  }

  private render(): void {
    const progress = this.progress;
    if (!progress) return;
    const wallet = starWallet(progress);
    this.walletEl.innerHTML = `<span class="menu-star-inline">${UI_ICON_SVGS.star}</span><b>${wallet.available}</b><span class="menu-stars-of">to spend</span>`;
    this.walletEl.title = `${wallet.earned} stars earned (${wallet.campaign} campaign + ${wallet.challenge} badges & dailies), ${wallet.spent} in upgrades`;

    this.bodyEl.innerHTML = '';
    for (const branch of WORKSHOP_BRANCHES) {
      const col = document.createElement('section');
      col.className = `ws-branch ws-branch-${branch.id}`;
      const h = document.createElement('h3');
      h.className = 'ws-branch-title';
      h.textContent = branch.name;
      col.appendChild(h);
      for (const def of WORKSHOP_UPGRADES) {
        if (def.branch !== branch.id) continue;
        col.appendChild(this.renderNode(def, wallet.available));
      }
      this.bodyEl.appendChild(col);
    }

    const total = workshopTotalCost();
    this.footNoteEl.innerHTML =
      wallet.earned === 0
        ? 'Win islands to earn stars. Each island gives up to 3★, challenges add bonus ★.'
        : `<b>${wallet.spent}</b>/${total}★ invested · earned ${wallet.earned}★${
            wallet.challenge > 0 ? ` (${wallet.challenge} from badges & dailies)` : ''
          } · applies on every island`;
    this.renderRefundLabel();
  }

  private renderNode(def: WorkshopUpgradeDef, available: number): HTMLElement {
    const progress = this.progress!;
    const rank = rankOf(progress.workshop, def.id);
    const max = maxRank(def);
    const cost = nextRankCost(progress.workshop, def.id);
    const affordable = cost !== null && cost <= available;

    const node = document.createElement('div');
    node.className = `ws-node gx gx-slate${rank >= max ? ' maxed' : ''}${rank > 0 ? ' owned' : ''}${
      this.lastBought === def.id ? ' just-bought' : ''
    }`;
    node.setAttribute('data-upgrade', def.id);

    const icon = document.createElement('div');
    icon.className = 'ws-node-icon';
    icon.innerHTML = upgradeIcon(def);

    const text = document.createElement('div');
    text.className = 'ws-node-text';
    const name = document.createElement('div');
    name.className = 'ws-node-name';
    name.textContent = def.name;
    const effect = document.createElement('div');
    effect.className = 'ws-node-effect';
    const now = rank > 0 ? def.rankText[rank - 1] : 'Not built';
    const next = rank < max ? def.rankText[rank] : null;
    effect.innerHTML = next
      ? `<span class="ws-now">${now}</span><span class="ws-arrow">→</span><span class="ws-next">${next}</span>`
      : `<span class="ws-now ws-max">${now}</span>`;
    const blurb = document.createElement('div');
    blurb.className = 'ws-node-blurb';
    blurb.textContent = def.blurb;
    const pips = document.createElement('div');
    pips.className = 'ws-pips';
    pips.setAttribute('aria-label', `Rank ${rank} of ${max}`);
    for (let i = 0; i < max; i++) {
      const pip = document.createElement('span');
      pip.className = `ws-pip${i < rank ? ' on' : ''}`;
      pips.appendChild(pip);
    }
    text.append(name, effect, blurb, pips);

    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = `ws-node-buy gx ${affordable ? 'gx-green' : 'gx-slate-btn'}`;
    buy.setAttribute('data-testid', `btn-ws-buy-${def.id}`);
    if (cost === null) {
      buy.disabled = true;
      buy.innerHTML = '<span class="btn-label">Max</span>';
      buy.setAttribute('aria-label', `${def.name} fully upgraded`);
    } else {
      buy.disabled = !affordable;
      buy.innerHTML = `<span class="ws-cost">${UI_ICON_SVGS.star}<b>${cost}</b></span>`;
      buy.setAttribute('aria-label', `Upgrade ${def.name} for ${cost} stars`);
      if (!affordable) buy.title = `Needs ${cost - available} more ★`;
      buy.addEventListener('click', () => {
        if (this.callbacks.onBuy(def.id)) {
          this.lastBought = def.id;
          this.render();
        }
      });
    }

    node.append(icon, text, buy);
    return node;
  }

  dispose(): void {
    window.clearTimeout(this.refundTimer);
    window.clearTimeout(this.enterTimer);
    this.rootEl.remove();
  }
}

/** Cheapest next rank the player can afford right now (null = nothing to buy) — drives menu badges. */
export function affordableUpgradeCount(progress: ProgressData): number {
  const available = starWallet(progress).available;
  let count = 0;
  for (const def of WORKSHOP_UPGRADES) {
    const cost = nextRankCost(progress.workshop, def.id);
    if (cost !== null && cost <= available) count++;
  }
  return count;
}
