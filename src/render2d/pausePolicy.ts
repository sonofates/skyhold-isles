/**
 * When a run pauses by itself on a PC (pure, unit-tested in tests/render/pcControls.test.ts):
 * - the window loses focus (alt-tab, another app on top, a click outside the window);
 * - the Steam overlay opens (its Shift+Tab hotkey, until the shell reports the overlay itself).
 * Touch devices pause on visibility instead (a phone never "blurs" while playing), except inside
 * the desktop shell, where a touchscreen laptop is still a PC.
 */

export interface BlurPauseInput {
  readonly touch: boolean;
  readonly desktopShell: boolean;
  readonly simActive: boolean;
  readonly paused: boolean;
  /** Bench / endless-demo runs never pause by themselves. */
  readonly endless: boolean;
  /** Settings / Codex boards already hold the run paused. */
  readonly sheetOpen: boolean;
}

export function shouldPauseOnBlur(s: BlurPauseInput): boolean {
  if (s.touch && !s.desktopShell) return false;
  return s.simActive && !s.paused && !s.endless && !s.sheetOpen;
}

/** Shift+Tab with Steam running: the default Steam overlay hotkey. */
export function isSteamOverlayHotkey(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>, isSteam: boolean): boolean {
  return isSteam && e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
}
