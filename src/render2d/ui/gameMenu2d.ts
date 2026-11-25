/**
 * The PC "Esc menu" outside a battle (the battle has its own pause menu, runControls2d.ts):
 * Esc on the world map with nothing else open shows a small board — Resume · Settings · Quit game.
 * Quit only exists in the desktop shell (a browser tab has nothing to quit to) and asks first.
 * `confirmQuit` is shared with the battle pause menu and the title screen.
 */
import { t } from '../../i18n/index.ts';
import { isDesktopShell, quitGame } from '../../platform/desktopShell.ts';
import { anySheetOpen, el, openSheet, plank } from './dom.ts';
import { confirmBoard } from './runControls2d.ts';

/** Asks "Quit the game?" and closes the shell on yes. */
export async function confirmQuit(): Promise<void> {
  if (!isDesktopShell()) return;
  const ok = await confirmBoard({ title: t('confirm.quitTitle'), body: t('confirm.quitBody'), yes: t('confirm.quitYes'), no: t('confirm.cancel'), testid: 'confirm-quit' });
  if (ok) quitGame();
}

export interface GameMenuHandlers {
  openSettings(onClose: () => void): void;
}

/** Opens the Esc board (no-op while another board is up). */
export function openGameMenu(h: GameMenuHandlers): void {
  if (anySheetOpen()) return;
  const sheet = openSheet(t('menu.title'), { cls: 'pu-confirm pu-game-menu', testid: 'game-menu' });
  const resume = plank(t('pause.resume'), { kind: 'small', icon: 'play', testid: 'game-menu-resume' });
  const settings = plank(t('hud.settings'), { kind: 'small', icon: 'settings', testid: 'game-menu-settings' });
  resume.addEventListener('click', () => sheet.close());
  settings.addEventListener('click', () => {
    sheet.close();
    h.openSettings(() => undefined);
  });
  const row = el('div', 'pu-confirm-row', {}, resume, settings);
  if (isDesktopShell()) {
    const quit = plank(t('menu.quit'), { kind: 'small', icon: 'close', testid: 'game-menu-quit' });
    quit.addEventListener('click', () => {
      sheet.close();
      void confirmQuit();
    });
    row.append(quit);
  }
  sheet.body.append(row);
  requestAnimationFrame(() => resume.focus({ preventScroll: true }));
}

/** Is this Esc press free for the game menu (no board, no overlay, not typed into a field)? */
export function escOpensGameMenu(e: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'repeat' | 'target'>): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented || e.repeat || anySheetOpen()) return false;
  if (typeof document !== 'undefined' && document.querySelector('.pu-overlay:not(.closing)')) return false; // i18n-ignore (selector)
  const tgt = e.target;
  return !(typeof HTMLInputElement !== 'undefined' && (tgt instanceof HTMLInputElement || tgt instanceof HTMLTextAreaElement));
}
