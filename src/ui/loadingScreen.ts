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
      <div class="loading-card">
        <div class="loading-badge">SKYHOLD ISLES</div>
        <h2 class="loading-title">Forging the Floating Isles…</h2>
        <div class="loading-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="loading-bar-fill"></div>
        </div>
        <div class="loading-meta">
          <span class="loading-detail">Initializing renderer…</span>
          <span class="loading-pct">0%</span>
        </div>
      </div>
    `;
    parent.appendChild(this.element);

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
      this.labelEl.textContent = `Loading ${detail}`;
    }
  }

  hide(): void {
    this.element.classList.add('loading-screen-done');
    window.setTimeout(() => {
      this.element.remove();
    }, 220);
  }
}
