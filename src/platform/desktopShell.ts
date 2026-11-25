/**
 * The Electron desktop shell as the renderer sees it (`window.skyholdDesktop`, desktop/preload.cjs):
 * window mode (windowed / borderless fullscreen), vsync (a startup switch: applies after a restart),
 * Quit to desktop, and the Steam rich-presence line. Every call is a safe no-op in a browser or the
 * mobile wrapper, so UI code can ask `isDesktopShell()` and otherwise fall back to the web build.
 */

export type DesktopWindowMode = 'windowed' | 'fullscreen';

export interface DesktopBridge {
  readonly platform: string;
  getWindowMode(): DesktopWindowMode;
  setWindowMode(mode: DesktopWindowMode): Promise<DesktopWindowMode>;
  onWindowModeChange(listener: (mode: DesktopWindowMode) => void): () => void;
  getVsync(): boolean;
  setVsync(on: boolean): Promise<boolean>;
  quit(): void;
}

export type PresenceState = 'menu' | 'map' | 'battle';

declare global {
  interface Window {
    skyholdDesktop?: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge | null {
  try {
    return typeof window !== 'undefined' && window.skyholdDesktop ? window.skyholdDesktop : null;
  } catch {
    return null;
  }
}

/** True inside the Electron shell (Steam running or not). */
export function isDesktopShell(): boolean {
  return desktopBridge() !== null;
}

/** Closes the game (Electron only). Returns false where there is nothing to quit to (a browser tab). */
export function quitGame(): boolean {
  const b = desktopBridge();
  if (!b) return false;
  b.quit();
  return true;
}

/** Steam rich presence ("Defending <island>"): ignored without Steam. */
export function setPresence(state: PresenceState, island = ''): void {
  try {
    const steam = typeof window !== 'undefined' ? window.skyholdSteam : undefined;
    steam?.setPresence?.(state, island);
  } catch {
    // cosmetic
  }
}
