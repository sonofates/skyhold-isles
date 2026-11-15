import { UI_ICON_SVGS } from './icons.ts';

export class GameToast {
  private readonly rootEl: HTMLDivElement;
  private readonly msgEl: HTMLSpanElement;
  private remainingSec = 0;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'game-toast hidden ui-interactive';
    this.rootEl.setAttribute('role', 'status');
    this.rootEl.setAttribute('aria-live', 'polite');
    this.rootEl.setAttribute('data-testid', 'game-toast');

    const iconEl = document.createElement('span');
    iconEl.className = 'game-toast-icon';
    iconEl.innerHTML = UI_ICON_SVGS.flyerAlert;

    this.msgEl = document.createElement('span');
    this.msgEl.className = 'game-toast-msg';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'game-toast-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Dismiss notice');
    closeBtn.addEventListener('click', () => this.hide());

    this.rootEl.append(iconEl, this.msgEl, closeBtn);
    parent.appendChild(this.rootEl);
  }

  show(message: string, durationSec = 6.0): void {
    this.msgEl.textContent = message;
    this.remainingSec = durationSec;
    this.visible = true;
    this.rootEl.classList.remove('hidden');
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.remainingSec = 0;
    this.rootEl.classList.add('hidden');
  }

  update(dt: number): void {
    if (!this.visible || dt <= 0) return;
    this.remainingSec -= dt;
    if (this.remainingSec <= 0) {
      this.hide();
    }
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
