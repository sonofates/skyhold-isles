import '../styles/sighting.css';
import { cardContent } from './cardContent.ts';
import type { CardRef } from './firstSighting.ts';

export interface SightingCardCallbacks {
  /** Called whenever the card opens or closes (so the session can pause / resume). */
  onVisibilityChange: () => void;
  onOpenCodex: (tab: 'enemies' | 'towers', id: string) => void;
  /** Another overlay (the codex) sits on top: ignore the keyboard. */
  isCoveredByOverlay?: () => boolean;
}

/** Compact "you just met something new" card. Holds a list; the player steps through it. */
export class SightingCard {
  private readonly backdrop: HTMLDivElement;
  private readonly cardEl: HTMLDivElement;
  private readonly kickerEl: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly iconEl: HTMLDivElement;
  private readonly tagsEl: HTMLDivElement;
  private readonly blurbEl: HTMLParagraphElement;
  private readonly tipLabelEl: HTMLSpanElement;
  private readonly tipTextEl: HTMLSpanElement;
  private readonly countEl: HTMLSpanElement;
  private readonly okBtn: HTMLButtonElement;
  private readonly codexBtn: HTMLButtonElement;
  private refs: CardRef[] = [];
  private index = 0;
  private open = false;
  private readonly cb: SightingCardCallbacks;
  private readonly keyHandler = (e: KeyboardEvent): void => {
    if (!this.open || this.cb.isCoveredByOverlay?.()) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      // Auto-repeat (a key held down when the card popped up) must not skip through the whole stack.
      if (e.type === 'keydown' && !e.repeat) this.advance();
    }
  };

  constructor(parent: HTMLElement, cb: SightingCardCallbacks) {
    this.cb = cb;
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'sc-backdrop hidden ui-interactive';
    this.backdrop.setAttribute('data-testid', 'sighting-card');

    this.cardEl = document.createElement('div');
    this.cardEl.className = 'sc-card gx gx-slate';
    this.cardEl.setAttribute('role', 'dialog');
    this.cardEl.setAttribute('aria-live', 'polite');

    const head = document.createElement('div');
    head.className = 'sc-head';
    this.iconEl = document.createElement('div');
    this.iconEl.className = 'sc-icon';
    const titles = document.createElement('div');
    titles.className = 'sc-titles';
    this.kickerEl = document.createElement('div');
    this.kickerEl.className = 'sc-kicker';
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'sc-name';
    this.tagsEl = document.createElement('div');
    this.tagsEl.className = 'sc-tags';
    titles.append(this.kickerEl, this.nameEl, this.tagsEl);
    head.append(this.iconEl, titles);

    this.blurbEl = document.createElement('p');
    this.blurbEl.className = 'sc-blurb';

    const tip = document.createElement('div');
    tip.className = 'sc-tip';
    this.tipLabelEl = document.createElement('span');
    this.tipLabelEl.className = 'sc-tip-label';
    this.tipTextEl = document.createElement('span');
    tip.append(this.tipLabelEl, this.tipTextEl);

    const actions = document.createElement('div');
    actions.className = 'sc-actions';
    this.countEl = document.createElement('span');
    this.countEl.className = 'sc-count';
    this.codexBtn = document.createElement('button');
    this.codexBtn.type = 'button';
    this.codexBtn.className = 'sc-codex';
    this.codexBtn.textContent = 'Codex';
    this.codexBtn.addEventListener('click', () => {
      const ref = this.refs[this.index];
      if (!ref) return;
      const c = cardContent(ref).codex;
      this.cb.onOpenCodex(c.tab, c.id);
    });
    this.okBtn = document.createElement('button');
    this.okBtn.type = 'button';
    this.okBtn.className = 'sc-ok btn-primary gx gx-green';
    this.okBtn.setAttribute('data-testid', 'sighting-ok');
    this.okBtn.addEventListener('click', () => this.advance());
    actions.append(this.countEl, this.codexBtn, this.okBtn);

    this.cardEl.append(head, this.blurbEl, tip, actions);
    this.backdrop.appendChild(this.cardEl);
    parent.appendChild(this.backdrop);
    window.addEventListener('keydown', this.keyHandler, true);
    window.addEventListener('keyup', this.keyHandler, true);
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Show `refs` (appended if a card is already up). */
  show(refs: readonly CardRef[]): void {
    if (refs.length === 0) return;
    this.refs.push(...refs);
    if (this.open) {
      this.render();
      return;
    }
    this.index = 0;
    this.open = true;
    this.backdrop.classList.remove('hidden');
    this.render();
    this.cb.onVisibilityChange();
  }

  private advance(): void {
    if (!this.open) return;
    if (this.index + 1 < this.refs.length) {
      this.index++;
      this.render();
      return;
    }
    this.close();
  }

  /** Closes the card and returns the refs after the one on screen (never shown to the player). */
  closeKeepingUnshown(): CardRef[] {
    const rest = this.open ? this.refs.slice(this.index + 1) : [];
    this.close();
    return rest;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.refs = [];
    this.index = 0;
    this.backdrop.classList.add('hidden');
    this.cb.onVisibilityChange();
  }

  private render(): void {
    const ref = this.refs[this.index];
    if (!ref) return;
    const c = cardContent(ref);
    this.cardEl.dataset.accent = c.accent;
    this.kickerEl.textContent = c.kicker;
    this.nameEl.textContent = c.name;
    this.iconEl.innerHTML = c.iconSvg;
    this.tagsEl.replaceChildren(
      ...c.tags.map((t) => {
        const s = document.createElement('span');
        s.className = 'sc-tag';
        s.textContent = t;
        return s;
      }),
    );
    this.blurbEl.textContent = c.blurb;
    this.tipLabelEl.textContent = c.tipLabel;
    this.tipTextEl.textContent = c.tip;
    const last = this.index + 1 >= this.refs.length;
    this.okBtn.textContent = last ? 'Got it' : 'Next';
    this.countEl.textContent = this.refs.length > 1 ? `${this.index + 1}/${this.refs.length}` : '';
    this.countEl.classList.toggle('hidden', this.refs.length <= 1);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keyHandler, true);
    window.removeEventListener('keyup', this.keyHandler, true);
    this.backdrop.remove();
  }
}
