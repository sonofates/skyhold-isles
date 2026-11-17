import './styles/saveCode.css';

export interface SaveCodeCallbacks {
  /** Current save as a code. */
  getCode: () => string;
  /** Merges a pasted code into the save; returns a line for the player. */
  load: (code: string) => { ok: boolean; message: string };
}

const SAVE_ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4H16L20 8V19C20 19.6 19.6 20 19 20H5C4.4 20 4 19.6 4 19V5C4 4.4 4.4 4 5 4Z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M8 4V9H15V4" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="14.5" r="2.4" fill="currentColor"/></svg>`;

/**
 * Settings (menu only) → "Save code": copy the save as text to move it to another device, or paste
 * a code to merge it in. Merging keeps the best of both saves, so loading can never lose progress.
 */
export class SaveCodePanel {
  readonly el: HTMLDivElement;
  private readonly openBtn: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly codeOut: HTMLTextAreaElement;
  private readonly codeIn: HTMLTextAreaElement;
  private readonly copyStatus: HTMLDivElement;
  private readonly loadStatus: HTMLDivElement;
  private readonly cb: SaveCodeCallbacks;

  constructor(cb: SaveCodeCallbacks) {
    this.cb = cb;
    this.el = document.createElement('div');
    this.el.className = 'save-code';

    this.openBtn = document.createElement('button');
    this.openBtn.type = 'button';
    this.openBtn.className = 'save-code-open';
    this.openBtn.setAttribute('data-testid', 'btn-save-code');
    this.openBtn.innerHTML = `<span class="btn-icon">${SAVE_ICON}</span><span>Save code…</span>`;
    this.openBtn.addEventListener('click', () => this.setExpanded(true));

    this.panel = document.createElement('div');
    this.panel.className = 'save-code-panel hidden';

    const outLabel = document.createElement('label');
    outLabel.className = 'save-code-label';
    outLabel.textContent = 'Your save code — keep it somewhere safe or paste it on another device';
    this.codeOut = document.createElement('textarea');
    this.codeOut.className = 'save-code-text';
    this.codeOut.readOnly = true;
    this.codeOut.rows = 3;
    this.codeOut.spellcheck = false;
    this.codeOut.setAttribute('data-testid', 'save-code-out');
    this.codeOut.addEventListener('focus', () => this.codeOut.select());
    outLabel.appendChild(this.codeOut);

    const copyRow = document.createElement('div');
    copyRow.className = 'save-code-row';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-secondary gx gx-slate-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.setAttribute('data-testid', 'btn-save-code-copy');
    copyBtn.addEventListener('click', () => void this.copy());
    this.copyStatus = document.createElement('div');
    this.copyStatus.className = 'save-code-status';
    this.copyStatus.setAttribute('aria-live', 'polite');
    copyRow.append(copyBtn, this.copyStatus);

    const inLabel = document.createElement('label');
    inLabel.className = 'save-code-label';
    inLabel.textContent = 'Load a code — merged with this save, nothing is lost';
    this.codeIn = document.createElement('textarea');
    this.codeIn.className = 'save-code-text';
    this.codeIn.rows = 2;
    this.codeIn.spellcheck = false;
    this.codeIn.placeholder = 'Paste a SKY2-… code';
    this.codeIn.setAttribute('data-testid', 'save-code-in');
    inLabel.appendChild(this.codeIn);

    const loadRow = document.createElement('div');
    loadRow.className = 'save-code-row';
    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'btn-secondary gx gx-green';
    loadBtn.textContent = 'Load';
    loadBtn.setAttribute('data-testid', 'btn-save-code-load');
    loadBtn.addEventListener('click', () => this.load());
    this.loadStatus = document.createElement('div');
    this.loadStatus.className = 'save-code-status';
    this.loadStatus.setAttribute('aria-live', 'polite');
    loadRow.append(loadBtn, this.loadStatus);

    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'save-code-done';
    done.textContent = 'Hide save code';
    done.addEventListener('click', () => this.setExpanded(false));

    this.panel.append(outLabel, copyRow, inLabel, loadRow, done);
    this.el.append(this.openBtn, this.panel);
  }

  setExpanded(on: boolean): void {
    this.panel.classList.toggle('hidden', !on);
    this.openBtn.classList.toggle('hidden', on);
    this.copyStatus.textContent = '';
    this.loadStatus.textContent = '';
    this.loadStatus.classList.remove('is-error', 'is-ok');
    if (on) {
      this.codeOut.value = this.cb.getCode();
      this.codeIn.value = '';
    }
  }

  setVisible(visible: boolean): void {
    this.el.classList.toggle('hidden', !visible);
    if (!visible) this.setExpanded(false);
  }

  private async copy(): Promise<void> {
    const text = this.codeOut.value;
    try {
      await navigator.clipboard.writeText(text);
      this.copyStatus.textContent = 'Copied!';
    } catch {
      // No clipboard permission (http, old browsers): leave the code selected for a manual copy.
      this.codeOut.focus();
      this.codeOut.select();
      this.copyStatus.textContent = 'Selected — copy it from the box';
    }
  }

  private load(): void {
    const code = this.codeIn.value.trim();
    if (!code) {
      this.loadStatus.textContent = 'Paste a code first.';
      this.loadStatus.className = 'save-code-status is-error';
      return;
    }
    const res = this.cb.load(code);
    this.loadStatus.textContent = res.message;
    this.loadStatus.className = `save-code-status ${res.ok ? 'is-ok' : 'is-error'}`;
    if (res.ok) {
      this.codeIn.value = '';
      this.codeOut.value = this.cb.getCode();
    }
  }
}
