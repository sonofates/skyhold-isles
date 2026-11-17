import './styles/updatePrompt.css';

/** Small pill shown when a new version of the game is ready: "Update ready - Reload". */
export class UpdatePrompt {
  private readonly rootEl: HTMLDivElement;

  constructor(parent: HTMLElement, onReload: () => void) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'update-prompt hidden ui-interactive';
    this.rootEl.setAttribute('role', 'status');
    this.rootEl.setAttribute('data-testid', 'update-prompt');

    const text = document.createElement('span');
    text.className = 'update-prompt-text';
    text.textContent = 'New version ready';

    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'update-prompt-btn gx gx-green';
    reload.textContent = 'Reload';
    reload.addEventListener('click', () => {
      reload.disabled = true;
      reload.textContent = 'Updating…';
      onReload();
    });

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'update-prompt-close';
    dismiss.setAttribute('aria-label', 'Later');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', () => this.hide());

    this.rootEl.append(text, reload, dismiss);
    parent.appendChild(this.rootEl);
  }

  show(): void {
    this.rootEl.classList.remove('hidden');
  }

  hide(): void {
    this.rootEl.classList.add('hidden');
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
