import type { EndlessMutatorDef, EndlessMutatorId } from '../data/endlessMutators.ts';
import { ENEMY_ICON_SVGS, UI_ICON_SVGS } from './icons.ts';
import './styles/stormChoice.css';

const CHEVRONS = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5L12 6.5L19 12.5" stroke="#f6bd41" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 18.5L12 12.5L19 18.5" stroke="#f6bd41" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const MUTATOR_ICONS: Record<EndlessMutatorId, string> = {
  tailwind: UI_ICON_SVGS.fast,
  ironbark: ENEMY_ICON_SVGS.brute,
  swarmtide: ENEMY_ICON_SVGS.grunt,
  vanguard: CHEVRONS,
  thickhide: UI_ICON_SVGS.heart,
  galeRiders: ENEMY_ICON_SVGS.flyer,
  leanPickings: UI_ICON_SVGS.coin,
};

export interface StormChoiceCallbacks {
  onPick: (slot: number, id: EndlessMutatorId) => void;
}

/**
 * Endless: before a wave that brings a new mutator, the player picks which of two joins the run.
 * Opens between waves (the game is paused while it is up); the first option is the island's
 * usual rotation, so skipping the choice (calling the wave from elsewhere) changes nothing.
 */
export class StormChoiceModal {
  private readonly backdrop: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly callbacks: StormChoiceCallbacks;
  private open = false;
  private slot = -1;

  constructor(parent: HTMLElement, callbacks: StormChoiceCallbacks) {
    this.callbacks = callbacks;
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop sc-backdrop hidden ui-interactive';
    this.backdrop.setAttribute('data-testid', 'storm-choice');
    this.card = document.createElement('div');
    this.card.className = 'modal-card sc-card gx gx-slate';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-label', 'Choose the next storm');
    this.backdrop.appendChild(this.card);
    parent.appendChild(this.backdrop);
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Slot currently offered (-1 when closed). */
  get offeredSlot(): number {
    return this.open ? this.slot : -1;
  }

  show(slot: number, endlessWave: number, offer: readonly EndlessMutatorDef[], active: readonly EndlessMutatorDef[]): void {
    this.open = true;
    this.slot = slot;
    this.card.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'sc-head';
    head.innerHTML = `<span class="sc-kicker">Endless wave ${endlessWave}</span><span class="sc-title">Choose the next storm</span>`;

    const sub = document.createElement('div');
    sub.className = 'sc-sub';
    sub.textContent = 'One of these joins the run and stays for good.';

    const options = document.createElement('div');
    options.className = 'sc-options';
    offer.forEach((m, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sc-option gx gx-slate-btn${i === 0 ? ' is-default' : ''}`;
      b.setAttribute('data-testid', `storm-option-${m.id}`);
      b.innerHTML = `<span class="sc-icon">${MUTATOR_ICONS[m.id]}</span>
        <span class="sc-name">${m.name}</span>
        <span class="sc-desc">${m.description}</span>
        ${active.some((a) => a.id === m.id) ? '<span class="sc-stack">stacks again</span>' : ''}`;
      b.addEventListener('click', () => {
        if (!this.open) return;
        this.hide();
        this.callbacks.onPick(slot, m.id);
      });
      options.appendChild(b);
    });

    const foot = document.createElement('div');
    foot.className = 'sc-foot';
    foot.textContent =
      active.length > 0 ? `In play: ${active.map((a) => a.name).join(' · ')}` : 'First mutator of this run';

    this.card.append(head, sub, options, foot);
    this.backdrop.classList.remove('hidden');
    this.card.querySelector<HTMLElement>('.sc-option')?.focus({ preventScroll: true });
  }

  hide(): void {
    this.open = false;
    this.slot = -1;
    this.backdrop.classList.add('hidden');
  }

  dispose(): void {
    this.backdrop.remove();
  }
}
