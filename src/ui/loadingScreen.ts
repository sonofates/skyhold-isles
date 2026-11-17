/**
 * Lightweight preloader screen shown before the main menu until all GLB models are parsed.
 */
export class LoadingScreen {
  readonly element: HTMLDivElement;
  private readonly fillEl: HTMLDivElement;
  private readonly pctEl: HTMLSpanElement;
  private readonly labelEl: HTMLSpanElement;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'loading-screen';
    this.element.innerHTML = `
      <div class="loading-card gx gx-slate">
        <div class="loading-badge">Skyhold</div>
        <h2 class="loading-title">Isles</h2>
        <div class="loading-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="loading-bar-fill"></div>
        </div>
        <div class="loading-meta">
          <span class="loading-detail">Starting…</span>
          <span class="loading-pct">0%</span>
        </div>
      </div>
    `;
    parent.appendChild(this.element);
    // The static splash from index.html has done its job: the real loading card is on screen.
    document.getElementById('boot-splash')?.remove();

    this.fillEl = this.element.querySelector('.loading-bar-fill') as HTMLDivElement;
    this.pctEl = this.element.querySelector('.loading-pct') as HTMLSpanElement;
    this.labelEl = this.element.querySelector('.loading-detail') as HTMLSpanElement;
  }

  setProgress(loaded: number, total: number, detail?: string): void {
    const ratio = total > 0 ? Math.max(0, Math.min(1, loaded / total)) : 0;
    const pct = Math.round(ratio * 100);
    this.fillEl.style.width = `${pct}%`;
    this.pctEl.textContent = `${pct}%`;
    const track = this.fillEl.parentElement;
    if (track) track.setAttribute('aria-valuenow', String(pct));
    if (detail) {
      this.labelEl.textContent = detail;
    }
  }

  /**
   * Replaces the progress bar with a friendly failure state and a Reload button.
   * Uses existing button classes + inline styles so it works without extra CSS.
   */
  showError(message: string): void {
    const card = this.element.querySelector('.loading-card') as HTMLDivElement | null;
    if (!card) return;
    this.element.classList.remove('loading-screen-done');
    card.setAttribute('role', 'alert');
    card.replaceChildren();

    const badge = document.createElement('div');
    badge.className = 'loading-badge';
    badge.textContent = 'Skyhold';

    const title = document.createElement('h2');
    title.className = 'loading-title';
    title.textContent = 'Load failed';

    const detail = document.createElement('p');
    detail.className = 'loading-detail';
    detail.textContent = message;

    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'btn-primary gx gx-green';
    reload.textContent = 'Reload';
    reload.addEventListener('click', () => window.location.reload());

    card.append(badge, title, detail, reload);
    reload.focus();
  }

  hide(): void {
    this.element.classList.add('loading-screen-done');
    window.setTimeout(() => {
      this.element.remove();
    }, 220);
  }
}
