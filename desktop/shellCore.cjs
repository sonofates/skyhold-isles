'use strict';

/**
 * Pure helpers of the Electron shell (no `electron` import), so the desktop policy can be unit
 * tested from vitest (`tests/platform/desktopShell.test.ts`) without launching Electron:
 *  - Steam App ID / IPC argument sanitising,
 *  - the window-state file (size, position, maximised, fullscreen) and its repair against the
 *    displays that exist now,
 *  - shell preferences that need a restart (vsync),
 *  - which keys the shell itself handles (F11 / Alt+Enter fullscreen, DevTools only in dev),
 *  - rich-presence strings.
 */

const path = require('node:path');

const DEFAULT_STEAM_APP_ID = 480;
const BUNDLE_ORIGIN = 'http://skyhold.local';

/** Smallest window the HUD and boards are laid out for (the shell's long-standing 960x540). */
const MIN_WINDOW = Object.freeze({ width: 960, height: 540 });
const DEFAULT_WINDOW = Object.freeze({ width: 1600, height: 900 });

const WINDOW_MODES = Object.freeze(['windowed', 'fullscreen']);

function resolveSteamAppId(env = process.env) {
  const raw = env.STEAM_APP_ID;
  if (raw !== undefined && raw !== '') {
    const parsed = Number.parseInt(String(raw).trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_STEAM_APP_ID;
}

function sanitizeToken(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

const sanitizeSlot = sanitizeToken;
const sanitizeAchievementId = sanitizeToken;

function isWindowMode(v) {
  return typeof v === 'string' && WINDOW_MODES.includes(v);
}

function finiteInt(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/**
 * Repairs a stored window state. `displays` = `screen.getAllDisplays()` work areas
 * (`[{ x, y, width, height }]`); a saved position that no longer overlaps any display (monitor
 * unplugged) is dropped so the window opens centred on the primary one.
 */
function parseWindowState(raw, displays = []) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const primary = displays[0] || { x: 0, y: 0, width: 1920, height: 1080 };
  const maxW = Math.max(MIN_WINDOW.width, ...displays.map((d) => d.width), primary.width);
  const maxH = Math.max(MIN_WINDOW.height, ...displays.map((d) => d.height), primary.height);
  let width = finiteInt(o.width);
  let height = finiteInt(o.height);
  if (width === null || height === null) {
    // First launch: 16:9 at 1600x900, shrunk to fit 85 % of a smaller work area (never below the minimum).
    const k = Math.min(1, (primary.width * 0.85) / DEFAULT_WINDOW.width, (primary.height * 0.85) / DEFAULT_WINDOW.height);
    width = Math.round(DEFAULT_WINDOW.width * k);
    height = Math.round(DEFAULT_WINDOW.height * k);
  }
  width = Math.max(MIN_WINDOW.width, Math.min(maxW, width));
  height = Math.max(MIN_WINDOW.height, Math.min(maxH, height));
  let x = finiteInt(o.x);
  let y = finiteInt(o.y);
  if (x !== null && y !== null) {
    // At least 64x64 px of the title bar region must be on a display.
    const visible = displays.some(
      (d) => x + width - 64 >= d.x && x + 64 <= d.x + d.width && y >= d.y - 8 && y + 64 <= d.y + d.height,
    );
    if (!visible) {
      x = null;
      y = null;
    }
  } else {
    x = null;
    y = null;
  }
  return {
    width,
    height,
    ...(x !== null && y !== null ? { x, y } : {}),
    maximized: o.maximized === true,
    // First launch opens fullscreen like most PC games; afterwards the player's last choice.
    mode: isWindowMode(o.mode) ? o.mode : 'fullscreen',
  };
}

/** Shell preferences read before the app is ready (Chromium switches cannot change later). */
function parseShellPrefs(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return { vsync: o.vsync !== false };
}

/** The Chromium switches for the shell prefs (vsync off = no GPU vsync and no frame-rate limit). */
function chromiumSwitchesFor(prefs) {
  return prefs.vsync ? [] : ['disable-gpu-vsync', 'disable-frame-rate-limit'];
}

/** Packaged builds never open DevTools; `SKYHOLD_DEVTOOLS=1` allows it in a dev checkout only. */
function devToolsAllowed(isPackaged, env = process.env) {
  return !isPackaged || env.SKYHOLD_DEVTOOLS === '1';
}

/**
 * What the shell does with a key before the page sees it (`before-input-event`):
 * 'fullscreen' (F11, Alt+Enter), 'devtools' (F12 / Ctrl+Shift+I in dev), 'block' (reload, zoom,
 * print, view-source and similar browser shortcuts that make no sense in a game), or null.
 */
function shellKeyAction(input, opts = {}) {
  if (!input || input.type !== 'keyDown') return null;
  const key = typeof input.key === 'string' ? input.key : '';
  const lower = key.toLowerCase();
  const ctrl = Boolean(input.control || input.meta);
  if (key === 'F11' && !ctrl && !input.alt && !input.shift) return 'fullscreen';
  if (key === 'Enter' && input.alt && !ctrl) return 'fullscreen';
  if (key === 'F12' || (ctrl && input.shift && (lower === 'i' || lower === 'j' || lower === 'c'))) {
    return opts.devTools ? 'devtools' : 'block';
  }
  if (key === 'F5' || (ctrl && (lower === 'r' || lower === 'p' || lower === 'u' || lower === 's' || lower === 'o'))) {
    return opts.devTools && key === 'F5' ? null : 'block';
  }
  if (ctrl && (key === '+' || key === '=' || key === '-' || key === '0' || key === '_')) return 'block';
  return null;
}

const PRESENCE_STATES = Object.freeze(['menu', 'map', 'battle']);

/** Plain-text Steam rich presence `status` for a sanitised renderer request, or null. */
function presenceStatus(req) {
  if (!req || typeof req !== 'object' || !PRESENCE_STATES.includes(req.state)) return null;
  const island = typeof req.island === 'string' ? req.island.replace(/[^\p{L}\p{N} '’&-]/gu, '').trim().slice(0, 48) : '';
  if (req.state === 'battle') return island ? `Defending ${island}` : 'Defending an island';
  if (req.state === 'map') return 'Charting the sky islands';
  return 'In the main menu';
}

/** Resolves a request path inside `dist/` (null when it would escape it). */
function resolveDistFile(distDir, urlPathname) {
  let decoded = '/';
  try {
    decoded = decodeURIComponent(urlPathname || '/');
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = decoded === '/' ? '2d.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(distDir, rel);
  const rootWithSep = distDir.endsWith(path.sep) ? distDir : distDir + path.sep;
  if (resolved !== distDir && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

function isAllowedAppOrigin(rawOrigin, env = process.env) {
  if (!rawOrigin) return false;
  try {
    const origin = new URL(rawOrigin).origin;
    if (origin === BUNDLE_ORIGIN) return true;
    const devUrl = env.STEAM_DEV_URL;
    return Boolean(devUrl && origin === new URL(devUrl).origin);
  } catch {
    return false;
  }
}

/** Every IPC channel the preload may use (main registers exactly these; tests keep them in sync). */
const IPC_CHANNELS = Object.freeze({
  invoke: Object.freeze([
    'steam:unlock-achievement',
    'steam:cloud-read',
    'steam:cloud-write',
    'desktop:set-window-mode',
    'desktop:set-vsync',
  ]),
  send: Object.freeze(['desktop:quit', 'steam:set-presence']),
  sendSync: Object.freeze(['steam:get-status', 'desktop:get-state']),
  events: Object.freeze(['steam:overlay-changed', 'desktop:window-mode-changed']),
});

module.exports = {
  BUNDLE_ORIGIN,
  DEFAULT_STEAM_APP_ID,
  DEFAULT_WINDOW,
  IPC_CHANNELS,
  MIN_WINDOW,
  PRESENCE_STATES,
  WINDOW_MODES,
  chromiumSwitchesFor,
  devToolsAllowed,
  isAllowedAppOrigin,
  isWindowMode,
  parseShellPrefs,
  parseWindowState,
  presenceStatus,
  resolveDistFile,
  resolveSteamAppId,
  sanitizeAchievementId,
  sanitizeSlot,
  shellKeyAction,
};
