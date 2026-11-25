import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProgressData } from '../../src/core/types.ts';
import { CHAPTERS } from '../../src/data/chapters.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { earnedSteamAchievementIds, exportAchievementManifest, STEAM_ACHIEVEMENTS } from '../../src/platform/achievements.ts';
import { createDefaultProgress } from '../../src/platform/storage.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

interface ShellCore {
  BUNDLE_ORIGIN: string;
  DEFAULT_STEAM_APP_ID: number;
  IPC_CHANNELS: { invoke: string[]; send: string[]; sendSync: string[]; events: string[] };
  MIN_WINDOW: { width: number; height: number };
  chromiumSwitchesFor(p: { vsync: boolean }): string[];
  devToolsAllowed(isPackaged: boolean, env?: Record<string, string | undefined>): boolean;
  isAllowedAppOrigin(o: string, env?: Record<string, string | undefined>): boolean;
  parseShellPrefs(raw: unknown): { vsync: boolean };
  parseWindowState(raw: unknown, displays?: { x: number; y: number; width: number; height: number }[]): {
    width: number;
    height: number;
    x?: number;
    y?: number;
    maximized: boolean;
    mode: 'windowed' | 'fullscreen';
  };
  presenceStatus(req: unknown): string | null;
  resolveDistFile(dir: string, p: string): string | null;
  resolveSteamAppId(env?: Record<string, string | undefined>): number;
  sanitizeSlot(v: unknown): string | null;
  shellKeyAction(input: Record<string, unknown>, opts?: { devTools?: boolean }): string | null;
}

const core = require(resolve(ROOT, 'desktop/shellCore.cjs')) as ShellCore;
const mainSrc = readFileSync(resolve(ROOT, 'desktop/main.cjs'), 'utf8');
const preloadSrc = readFileSync(resolve(ROOT, 'desktop/preload.cjs'), 'utf8');

describe('Electron shell policy (desktop/shellCore.cjs)', () => {
  const FHD = [{ x: 0, y: 0, width: 1920, height: 1040 }];

  it('first launch: 16:9 fullscreen (1600x900 window behind it), shrunk to 85 % of a small screen, never under the minimum', () => {
    expect(core.parseWindowState(null, [{ x: 0, y: 0, width: 2560, height: 1400 }])).toEqual({ width: 1600, height: 900, maximized: false, mode: 'fullscreen' });
    const fhd = core.parseWindowState(null, FHD);
    expect(fhd.height).toBe(884);
    expect(Math.abs(fhd.width / fhd.height - 16 / 9)).toBeLessThan(0.01);
    const small = core.parseWindowState(undefined, [{ x: 0, y: 0, width: 1280, height: 680 }]);
    expect(small.width).toBe(1028);
    expect(small.height).toBe(578);
    const tiny = core.parseWindowState({}, [{ x: 0, y: 0, width: 800, height: 500 }]);
    expect(tiny.width).toBe(core.MIN_WINDOW.width);
    expect(tiny.height).toBe(core.MIN_WINDOW.height);
  });

  it('restores size / position / mode, drops a position on an unplugged monitor, clamps junk', () => {
    const st = core.parseWindowState({ width: 1280, height: 720, x: 100, y: 80, maximized: true, mode: 'windowed' }, FHD);
    expect(st).toEqual({ width: 1280, height: 720, x: 100, y: 80, maximized: true, mode: 'windowed' });
    // Saved on a second monitor that is gone now: centred on the primary instead.
    const gone = core.parseWindowState({ width: 1280, height: 720, x: 2600, y: 100, mode: 'windowed' }, FHD);
    expect(gone.x).toBeUndefined();
    expect(gone.y).toBeUndefined();
    // Two monitors: a window on the second one stays there.
    const two = core.parseWindowState({ width: 1280, height: 720, x: 2100, y: 100, mode: 'windowed' }, [...FHD, { x: 1920, y: 0, width: 2560, height: 1400 }]);
    expect(two.x).toBe(2100);
    const junk = core.parseWindowState({ width: 'big', height: 1e9, x: NaN, mode: 'exclusive' }, FHD);
    expect(junk.mode).toBe('fullscreen');
    expect(junk.width).toBeGreaterThanOrEqual(core.MIN_WINDOW.width);
    expect(junk.height).toBeLessThanOrEqual(1040);
  });

  it('vsync defaults on; off adds the Chromium switches (applied at the next start)', () => {
    expect(core.parseShellPrefs(null)).toEqual({ vsync: true });
    expect(core.parseShellPrefs({ vsync: false })).toEqual({ vsync: false });
    expect(core.chromiumSwitchesFor({ vsync: true })).toEqual([]);
    expect(core.chromiumSwitchesFor({ vsync: false })).toEqual(['disable-gpu-vsync', 'disable-frame-rate-limit']);
  });

  it('F11 / Alt+Enter toggle fullscreen; DevTools only in a dev checkout; browser shortcuts are blocked', () => {
    const down = (o: Record<string, unknown>) => ({ type: 'keyDown', control: false, meta: false, alt: false, shift: false, ...o });
    expect(core.shellKeyAction(down({ key: 'F11' }))).toBe('fullscreen');
    expect(core.shellKeyAction(down({ key: 'Enter', alt: true }))).toBe('fullscreen');
    expect(core.shellKeyAction(down({ key: 'Enter' }))).toBeNull();
    expect(core.shellKeyAction({ type: 'keyUp', key: 'F11' })).toBeNull();
    expect(core.shellKeyAction(down({ key: 'F12' }), { devTools: false })).toBe('block');
    expect(core.shellKeyAction(down({ key: 'I', control: true, shift: true }), { devTools: false })).toBe('block');
    expect(core.shellKeyAction(down({ key: 'F12' }), { devTools: true })).toBe('devtools');
    for (const k of [{ key: 'r', control: true }, { key: 'F5' }, { key: 'p', control: true }, { key: '=', control: true }, { key: '-', control: true }, { key: '0', control: true }]) {
      expect(core.shellKeyAction(down(k)), JSON.stringify(k)).toBe('block');
    }
    // Game keys pass through untouched.
    for (const k of ['q', ' ', 'Escape', 'Tab', '1']) expect(core.shellKeyAction(down({ key: k }))).toBeNull();
    expect(core.devToolsAllowed(true, {})).toBe(false);
    expect(core.devToolsAllowed(true, { SKYHOLD_DEVTOOLS: '1' })).toBe(true);
    expect(core.devToolsAllowed(false, {})).toBe(true);
  });

  it('App ID 480 placeholder unless STEAM_APP_ID is set; IPC inputs are sanitised; offline origin only', () => {
    expect(core.DEFAULT_STEAM_APP_ID).toBe(480);
    expect(core.resolveSteamAppId({})).toBe(480);
    expect(core.resolveSteamAppId({ STEAM_APP_ID: '3123450' })).toBe(3123450);
    expect(core.resolveSteamAppId({ STEAM_APP_ID: 'abc' })).toBe(480);
    expect(core.sanitizeSlot('../etc/passwd')).toBeNull();
    expect(core.sanitizeSlot('progress2d')).toBe('progress2d');
    expect(core.isAllowedAppOrigin('http://skyhold.local/2d.html', {})).toBe(true);
    expect(core.isAllowedAppOrigin('https://example.com/', {})).toBe(false);
    expect(core.isAllowedAppOrigin('http://localhost:5173/', {})).toBe(false);
    expect(core.isAllowedAppOrigin('http://localhost:5173/', { STEAM_DEV_URL: 'http://localhost:5173/2d.html' })).toBe(true);
    const dist = resolve(ROOT, 'dist');
    expect(core.resolveDistFile(dist, '/')).toBe(resolve(dist, '2d.html'));
    expect(core.resolveDistFile(dist, '/../package.json')).toBeNull();
    expect(core.resolveDistFile(dist, '/%2e%2e/package.json')).toBeNull();
  });

  it('rich presence: three plain states, island names sanitised', () => {
    expect(core.presenceStatus({ state: 'map' })).toBe('Charting the sky islands');
    expect(core.presenceStatus({ state: 'menu' })).toBe('In the main menu');
    expect(core.presenceStatus({ state: 'battle', island: 'Duskfall Landing' })).toBe('Defending Duskfall Landing');
    expect(core.presenceStatus({ state: 'battle', island: '<script>x</script>' })).toBe('Defending scriptxscript');
    expect(core.presenceStatus({ state: 'hack' })).toBeNull();
    expect(core.presenceStatus('battle')).toBeNull();
  });

  it('the preload uses exactly the allow-listed IPC channels, and main registers them all', () => {
    const used = new Set([...preloadSrc.matchAll(/ipcRenderer\.(?:invoke|send|sendSync|on)\('([^']+)'/g)].map((m) => m[1]));
    const allowed = new Set([...core.IPC_CHANNELS.invoke, ...core.IPC_CHANNELS.send, ...core.IPC_CHANNELS.sendSync, ...core.IPC_CHANNELS.events]);
    expect([...used].sort()).toEqual([...allowed].sort());
    for (const ch of core.IPC_CHANNELS.invoke) expect(mainSrc).toContain(`ipcMain.handle('${ch}'`);
    for (const ch of [...core.IPC_CHANNELS.send, ...core.IPC_CHANNELS.sendSync]) expect(mainSrc).toContain(`ipcMain.on('${ch}'`);
    // Every handler checks the sender's origin.
    const handlers = mainSrc.split(/ipcMain\.(?:on|handle)\(/).slice(1);
    for (const h of handlers) expect(h.slice(0, 260)).toContain('isTrustedIpcSender(event)');
  });

  it('production hardening is in place', () => {
    for (const s of [
      'contextIsolation: true',
      'nodeIntegration: false',
      'sandbox: true',
      'webviewTag: false',
      'devTools,',
      'Menu.setApplicationMenu(null)',
      "'before-input-event'",
      "'render-process-gone'",
      "'will-attach-webview'",
      'setWindowOpenHandler',
      "'zoom-changed'",
      'minWidth: MIN_WINDOW.width',
      "writeJson('window-state.json'",
    ]) {
      expect(mainSrc, s).toContain(s);
    }
    const builder = JSON.parse(readFileSync(resolve(ROOT, 'desktop/electron-builder.json'), 'utf8')) as { files: string[]; appId: string; productName: string };
    expect(builder.files).toContain('desktop/shellCore.cjs');
    // Owner-gated identity: unchanged.
    expect(builder.appId).toBe('com.skyholdisles.game');
    expect(builder.productName).toBe('Skyhold Isles');
  });
});

describe('Steam achievements for Chapters 4 and 5', () => {
  const late = ['CHAPTER_FOUR_LANDING', 'CHAPTER_FOUR_CLEARED', 'CHAPTER_FOUR_THREE_STARS', 'BOSS_I36_CLEARED', 'CHAPTER_FIVE_LANDING'];

  it('are appended after the older 58 (no existing index moves) and listed in desktop/achievements.json', () => {
    expect(STEAM_ACHIEVEMENTS.slice(58).map((a) => a.id)).toEqual(late);
    const onDisk = JSON.parse(readFileSync(resolve(ROOT, 'desktop/achievements.json'), 'utf8')) as { id: string }[];
    expect(onDisk.map((a) => a.id)).toEqual(exportAchievementManifest().map((a) => a.id));
  });

  it('unlock from the chapter lists by island id', () => {
    const idx = (id: string): number => LEVELS_2D.findIndex((l) => l.id === id);
    const p: ProgressData = createDefaultProgress(LEVELS_2D.length);
    const ch4 = CHAPTERS.find((c) => c.id === 'ch4')!.islands;
    const ch5 = CHAPTERS.find((c) => c.id === 'ch5')!.islands;
    expect(earnedSteamAchievementIds(p, LEVELS_2D).filter((id) => late.includes(id))).toEqual([]);
    p.clears[idx('i28')] = 1;
    p.bestStars[idx('i28')] = 2;
    let earned = new Set(earnedSteamAchievementIds(p, LEVELS_2D));
    expect(earned.has('CHAPTER_FOUR_LANDING')).toBe(true);
    expect(earned.has('CHAPTER_FOUR_CLEARED')).toBe(false);
    for (const id of ch4) {
      p.clears[idx(id)] = 1;
      p.bestStars[idx(id)] = 3;
    }
    earned = new Set(earnedSteamAchievementIds(p, LEVELS_2D));
    expect(earned.has('CHAPTER_FOUR_CLEARED')).toBe(true);
    expect(earned.has('CHAPTER_FOUR_THREE_STARS')).toBe(true);
    expect(earned.has('BOSS_I36_CLEARED')).toBe(true);
    expect(earned.has('CHAPTER_FIVE_LANDING')).toBe(false);
    // Chapter 5: landing as soon as one of its islands is cleared (cleared / 3-star wait for i45).
    const present5 = ch5.filter((id) => idx(id) >= 0);
    expect(present5.length).toBeGreaterThan(0);
    for (const id of present5) {
      p.clears[idx(id)] = 1;
      p.bestStars[idx(id)] = 3;
    }
    earned = new Set(earnedSteamAchievementIds(p, LEVELS_2D));
    expect(earned.has('CHAPTER_FIVE_LANDING')).toBe(true);
    expect(STEAM_ACHIEVEMENTS.some((a) => a.id === 'CHAPTER_FIVE_CLEARED')).toBe(false);
  });
});
