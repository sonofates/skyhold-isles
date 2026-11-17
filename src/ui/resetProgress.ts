import { UI_ICON_SVGS } from './icons.ts';
import './styles/resetProgress.css';

/**
 * Settings → "Reset progress" with an explicit confirm step (two separate buttons, no timing
 * tricks). The session keeps a backup copy of the erased save in localStorage.
 */
export class ResetProgressRow {
  readonly el: HTMLDivElement;
  private readonly confirmEl: HTMLDivElement;
  private readonly openBtn: HTMLButtonElement;

  constructor(onConfirm: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'reset-progress';

    this.openBtn = document.createElement('button');
    this.openBtn.type = 'button';
    this.openBtn.className = 'reset-open-btn';
    this.openBtn.setAttribute('data-testid', 'btn-reset-progress');
    this.openBtn.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.restart}</span><span>Reset progress…</span>`;
    this.openBtn.addEventListener('click', () => this.setConfirming(true));

    this.confirmEl = document.createElement('div');
    this.confirmEl.className = 'reset-confirm hidden';
    this.confirmEl.setAttribute('role', 'alertdialog');
    const msg = document.createElement('div');
    msg.className = 'reset-msg';
    msg.innerHTML = '<b>Erase all progress?</b> Stars, unlocked islands, Workshop upgrades, challenge badges and endless records are reset. Settings stay.';
    const row = document.createElement('div');
    row.className = 'reset-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn-secondary gx gx-slate-btn';
    cancel.textContent = 'Keep';
    cancel.setAttribute('data-testid', 'btn-reset-cancel');
    cancel.addEventListener('click', () => this.setConfirming(false));
    const erase = document.createElement('button');
    erase.type = 'button';
    erase.className = 'btn-secondary gx gx-coral';
    erase.textContent = 'Erase';
    erase.setAttribute('data-testid', 'btn-reset-confirm');
    erase.addEventListener('click', () => {
      this.setConfirming(false);
      onConfirm();
    });
    row.append(cancel, erase);
    this.confirmEl.append(msg, row);

    this.el.append(this.openBtn, this.confirmEl);
  }

  setConfirming(on: boolean): void {
    this.confirmEl.classList.toggle('hidden', !on);
    this.openBtn.classList.toggle('hidden', on);
  }

  setVisible(visible: boolean): void {
    this.el.classList.toggle('hidden', !visible);
    if (!visible) this.setConfirming(false);
  }
}
