/**
 * Adds the Codex buttons to the main menu, the island select header and the pause menu by decorating the
 * DOM those overlays already built. Keeps this feature out of menus.ts / gameModals.ts (other branches
 * edit them heavily); if a container is not found the button is simply skipped.
 */
const BOOK_ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M4.5 5.5C7.5 4.6 10 5 12 6.6C14 5 16.5 4.6 19.5 5.5V18.5C16.5 17.6 14 18 12 19.5C10 18 7.5 17.6 4.5 18.5V5.5Z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M12 7V19" stroke="#1b1936" stroke-opacity=".55" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

function makeButton(className: string, label: string, testId: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.setAttribute('data-testid', testId);
  btn.setAttribute('aria-label', 'Codex');
  btn.innerHTML = `<span class="btn-icon">${BOOK_ICON}</span><span class="btn-label">${label}</span>`;
  btn.addEventListener('click', onClick);
  return btn;
}

export function mountCodexEntryPoints(uiRoot: HTMLElement, openCodex: () => void): void {
  const mainRow = uiRoot.querySelector('.menu-card-main .menu-btn-row');
  if (mainRow) {
    mainRow.appendChild(
      makeButton('btn-secondary btn-lg gx gx-slate-btn cx-entry cx-entry-wide', 'Codex', 'btn-codex', openCodex),
    );
  }

  const levelHeader = uiRoot.querySelector('.level-select-header');
  if (levelHeader) {
    levelHeader.appendChild(makeButton('cx-entry cx-entry-chip gx gx-slate-btn', 'Codex', 'btn-codex-levels', openCodex));
  }

  const pauseTiles = uiRoot.querySelector('.pause-tiles');
  if (pauseTiles) {
    pauseTiles.appendChild(
      makeButton('btn-secondary gx gx-slate-btn pause-tile cx-entry cx-entry-wide', 'Codex', 'btn-pause-codex', openCodex),
    );
  }
}
