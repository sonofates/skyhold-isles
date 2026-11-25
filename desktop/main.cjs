'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, session } = require('electron');
const core = require('./shellCore.cjs');

const { BUNDLE_ORIGIN, DEFAULT_STEAM_APP_ID, MIN_WINDOW, isAllowedAppOrigin, resolveDistFile, sanitizeAchievementId, sanitizeSlot } = core;
const SESSION_PARTITION = 'persist:skyhold';

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function mimeFor(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

const isSmokeTest = process.env.SKYHOLD_SMOKE_TEST === '1';
const devTools = core.devToolsAllowed(app.isPackaged);
const appId = core.resolveSteamAppId();
let steamClient = null;
let isSteam = false;
let overlayActive = false;

// --- small JSON files in userData (window state, shell prefs) and a crash log --------------------

function userFile(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(userFile(name), 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(name, value) {
  if (isSmokeTest) return;
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const file = userFile(name);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
    fs.renameSync(`${file}.tmp`, file);
  } catch {
    // read-only profile: the game still runs, it just forgets the window
  }
}

/** Appends a line to `<userData>/logs/shell.log` (crashes, unresponsive renderer, main errors). */
function logLine(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  console.error(`[shell] ${message}`);
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'shell.log');
    // Keep the log small: start over past 256 KB.
    if (fs.existsSync(file) && fs.statSync(file).size > 256 * 1024) fs.writeFileSync(file, '');
    fs.appendFileSync(file, line);
  } catch {
    // ignore
  }
}

process.on('uncaughtException', (err) => {
  logLine(`uncaughtException: ${err && err.stack ? err.stack : String(err)}`);
});
process.on('unhandledRejection', (err) => {
  logLine(`unhandledRejection: ${err && err.stack ? err.stack : String(err)}`);
});

// Shell prefs are read before `ready`: vsync is a Chromium switch.
let shellPrefs = core.parseShellPrefs(readJson('shell-prefs.json'));

// --- Steam ------------------------------------------------------------------------------------

function broadcast(channel, value) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, value);
  }
}

function broadcastOverlay(active) {
  const next = Boolean(active);
  if (next === overlayActive) return;
  overlayActive = next;
  broadcast('steam:overlay-changed', overlayActive);
}

function initSteamworks() {
  if (process.env.SKYHOLD_DISABLE_STEAM === '1') return;
  try {
    const steamworks = require('steamworks.js');
    steamClient = steamworks.init(appId);
    isSteam = true;
    if (typeof steamworks.electronEnableSteamOverlay === 'function') {
      steamworks.electronEnableSteamOverlay();
    }
    const cbEnum = steamworks.SteamCallback;
    if (
      cbEnum &&
      typeof cbEnum.GameOverlayActivated === 'number' &&
      steamClient &&
      steamClient.callback &&
      typeof steamClient.callback.register === 'function'
    ) {
      steamClient.callback.register(cbEnum.GameOverlayActivated, (payload) => {
        broadcastOverlay(Boolean(payload && (payload.active ?? payload.m_bActive)));
      });
    }
    console.info(`[steam] Initialised Steamworks (appId=${appId})`);
  } catch (err) {
    steamClient = null;
    isSteam = false;
    const reason = err instanceof Error ? err.message : String(err);
    console.info(`[steam] Steam unavailable (appId=${appId}): ${reason}. Running standalone.`);
  }
}

function configureChromiumSwitches() {
  // Keep WebGL2 available across older Linux Mesa drivers, VMs, and software fallbacks.
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  // Mark bundled offline origin secure so navigator.clipboard (Save Code / Share) works while
  // keeping BUNDLE_ORIGIN stable for existing persist:skyhold localStorage data.
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', BUNDLE_ORIGIN);
  for (const sw of core.chromiumSwitchesFor(shellPrefs)) app.commandLine.appendSwitch(sw);

  if (process.env.SKYHOLD_SWIFTSHADER === '1' || isSmokeTest) {
    app.commandLine.appendSwitch('use-gl', 'angle');
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
  }
  if (process.platform === 'linux') {
    let lowShm = isSmokeTest;
    if (!lowShm && typeof fs.statfsSync === 'function') {
      try {
        const st = fs.statfsSync('/dev/shm');
        if (st && st.bavail * st.bsize < 128 * 1024 * 1024) lowShm = true;
      } catch {
        lowShm = true;
      }
    }
    if (lowShm) {
      app.commandLine.appendSwitch('disable-dev-shm-usage');
    }
  }
}

configureChromiumSwitches();

const gotSingleInstanceLock = isSmokeTest ? true : app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  initSteamworks();
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

/** Known achievement IDs from `desktop/achievements.json` (extra guard on IPC). */
const knownAchievementIds = (() => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'achievements.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.map((a) => a && a.id).filter((id) => typeof id === 'string'));
    }
  } catch {
    // allow fallback validation when achievements.json is absent
  }
  return null;
})();

function isTrustedIpcSender(event) {
  const senderUrl =
    (event && event.senderFrame && event.senderFrame.url) ||
    (event && event.sender && typeof event.sender.getURL === 'function' ? event.sender.getURL() : '');
  return isAllowedAppOrigin(senderUrl);
}

function windowOf(event) {
  const win = event && event.sender ? BrowserWindow.fromWebContents(event.sender) : null;
  return win && !win.isDestroyed() ? win : null;
}

ipcMain.on('steam:get-status', (event) => {
  if (!isTrustedIpcSender(event)) {
    event.returnValue = {
      isSteam: false,
      appId: DEFAULT_STEAM_APP_ID,
      overlayActive: false,
    };
    return;
  }
  event.returnValue = {
    isSteam,
    appId,
    overlayActive,
  };
});

ipcMain.handle('steam:unlock-achievement', async (event, rawId) => {
  if (!isTrustedIpcSender(event) || !isSteam || !steamClient) return false;
  const id = sanitizeAchievementId(rawId);
  if (!id) return false;
  if (knownAchievementIds && knownAchievementIds.size > 0 && !knownAchievementIds.has(id)) {
    return false;
  }
  try {
    if (steamClient.achievement.isActivated(id)) return true;
    return Boolean(steamClient.achievement.activate(id));
  } catch {
    return false;
  }
});

ipcMain.handle('steam:cloud-read', async (event, rawSlot) => {
  if (!isTrustedIpcSender(event)) throw new Error('Untrusted IPC sender');
  if (!isSteam || !steamClient) return null;
  const slot = sanitizeSlot(rawSlot);
  if (!slot) return null;
  const fileName = `skyhold_${slot}.json`;
  if (!steamClient.cloud.isEnabledForAccount() || !steamClient.cloud.isEnabledForApp()) {
    return null;
  }
  if (!steamClient.cloud.fileExists(fileName)) return null;
  const content = steamClient.cloud.readFile(fileName);
  if (typeof content !== 'string') {
    throw new Error(`Steam Cloud read failed for ${fileName}`);
  }
  return content;
});

ipcMain.handle('steam:cloud-write', async (event, rawSlot, rawJson) => {
  if (!isTrustedIpcSender(event) || !isSteam || !steamClient) return false;
  const slot = sanitizeSlot(rawSlot);
  if (
    !slot ||
    typeof rawJson !== 'string' ||
    rawJson.trim().length === 0 ||
    rawJson.length > 2 * 1024 * 1024
  ) {
    return false;
  }
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object') return false;
  } catch {
    return false;
  }
  const fileName = `skyhold_${slot}.json`;
  try {
    if (!steamClient.cloud.isEnabledForAccount() || !steamClient.cloud.isEnabledForApp()) {
      return false;
    }
    return Boolean(steamClient.cloud.writeFile(fileName, rawJson));
  } catch {
    return false;
  }
});

// Steam rich presence: a plain `status` line ("Defending <island>") when Steam is running.
let lastPresence = '';
ipcMain.on('steam:set-presence', (event, req) => {
  if (!isTrustedIpcSender(event) || !isSteam || !steamClient) return;
  const status = core.presenceStatus(req);
  if (!status || status === lastPresence) return;
  lastPresence = status;
  try {
    if (steamClient.localplayer && typeof steamClient.localplayer.setRichPresence === 'function') {
      steamClient.localplayer.setRichPresence('status', status);
    }
  } catch {
    // presence is cosmetic
  }
});

// --- desktop shell IPC (window mode, vsync, quit) ------------------------------------------------

function windowMode(win) {
  return win && win.isFullScreen() ? 'fullscreen' : 'windowed';
}

ipcMain.on('desktop:get-state', (event) => {
  if (!isTrustedIpcSender(event)) {
    event.returnValue = null;
    return;
  }
  event.returnValue = { mode: windowMode(windowOf(event)), vsync: shellPrefs.vsync, platform: process.platform };
});

ipcMain.handle('desktop:set-window-mode', async (event, mode) => {
  const win = windowOf(event);
  if (!isTrustedIpcSender(event) || !win || !core.isWindowMode(mode)) return windowMode(win);
  win.setFullScreen(mode === 'fullscreen');
  return mode;
});

ipcMain.handle('desktop:set-vsync', async (event, on) => {
  if (!isTrustedIpcSender(event) || typeof on !== 'boolean') return shellPrefs.vsync;
  shellPrefs = { ...shellPrefs, vsync: on };
  writeJson('shell-prefs.json', shellPrefs);
  return shellPrefs.vsync;
});

ipcMain.on('desktop:quit', (event) => {
  if (!isTrustedIpcSender(event)) return;
  app.quit();
});

// --- bundle protocol & session -------------------------------------------------------------------

const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen']);

function configureSessionPermissions(ses) {
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isAllowedAppOrigin(requestingOrigin);
  });
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = (details && details.requestingUrl) || (wc && wc.getURL ? wc.getURL() : '');
    callback(ALLOWED_PERMISSIONS.has(permission) && isAllowedAppOrigin(origin));
  });
}

function registerBundleProtocol(ses, distDir) {
  // Offline only: nothing but the bundled files ever loads (no https, no other hosts).
  ses.protocol.handle('https', () => new Response('Blocked external request', { status: 403 }));
  ses.protocol.handle('http', async (request) => {
    const parsed = new URL(request.url);
    if (parsed.origin !== BUNDLE_ORIGIN) {
      return new Response('Blocked external request', { status: 403 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    const target = resolveDistFile(distDir, parsed.pathname);
    if (!target) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const stat = await fsp.stat(target);
      if (!stat.isFile()) {
        return new Response('Not Found', { status: 404 });
      }
      const headers = {
        'content-type': mimeFor(target),
        'content-length': String(stat.size),
      };
      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers });
      }
      const data = await fsp.readFile(target);
      return new Response(data, { status: 200, headers });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });
}

function loadWindowIcon(distDir) {
  const iconPath = path.join(distDir, 'icons', 'icon-512.png');
  try {
    if (!fs.existsSync(iconPath)) return undefined;
    const img = nativeImage.createFromBuffer(fs.readFileSync(iconPath));
    return img.isEmpty() ? undefined : img;
  } catch {
    return undefined;
  }
}

/** No browser menu (reload / zoom / DevTools accelerators); macOS keeps the standard app menu. */
function installMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'togglefullscreen' }, { role: 'close' }] },
    ]),
  );
}

// --- the window ---------------------------------------------------------------------------------

function displayAreas() {
  try {
    const primary = screen.getPrimaryDisplay();
    const all = screen.getAllDisplays();
    return [primary, ...all.filter((d) => d.id !== primary.id)].map((d) => d.workArea);
  } catch {
    return [];
  }
}

function trackWindowState(win, initial) {
  let normal = { width: initial.width, height: initial.height, x: initial.x, y: initial.y };
  let timer = null;
  const save = () => {
    timer = null;
    if (win.isDestroyed()) return;
    writeJson('window-state.json', {
      ...normal,
      maximized: win.isMaximized(),
      mode: windowMode(win),
    });
  };
  const capture = () => {
    if (win.isDestroyed()) return;
    if (!win.isFullScreen() && !win.isMaximized() && !win.isMinimized()) {
      const b = win.getBounds();
      normal = { width: b.width, height: b.height, x: b.x, y: b.y };
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  const modeChanged = () => {
    capture();
    if (!win.isDestroyed()) win.webContents.send('desktop:window-mode-changed', windowMode(win));
  };
  win.on('resize', capture);
  win.on('move', capture);
  win.on('maximize', capture);
  win.on('unmaximize', capture);
  win.on('enter-full-screen', modeChanged);
  win.on('leave-full-screen', modeChanged);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
}

function hardenWebContents(win) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedAppOrigin(targetUrl)) event.preventDefault();
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.on('before-input-event', (event, input) => {
    const action = core.shellKeyAction(input, { devTools });
    if (action === 'fullscreen') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    } else if (action === 'devtools') {
      event.preventDefault();
      wc.toggleDevTools();
    } else if (action === 'block') {
      event.preventDefault();
    }
  });
  // Ctrl+wheel / pinch must not zoom the page: the game has its own Interface size setting.
  wc.on('zoom-changed', () => wc.setZoomLevel(0));
  wc.on('did-finish-load', () => {
    wc.setZoomLevel(0);
    void wc.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
  });
  // A crashed renderer reloads (at most 3 times a minute), then the player gets a message.
  const crashes = [];
  wc.on('render-process-gone', (_event, details) => {
    const reason = details && details.reason;
    logLine(`render-process-gone: ${reason} (exitCode ${details && details.exitCode})`);
    if (reason === 'clean-exit' || win.isDestroyed()) return;
    const now = Date.now();
    while (crashes.length && now - crashes[0] > 60_000) crashes.shift();
    crashes.push(now);
    if (crashes.length <= 3 && !isSmokeTest) {
      wc.reload();
      return;
    }
    if (!isSmokeTest) {
      dialog.showErrorBox('Skyhold Isles', `The game stopped unexpectedly (${reason}). Your progress is saved. A log was written to ${path.join(app.getPath('userData'), 'logs', 'shell.log')}.`);
    }
    app.exit(1);
  });
  wc.on('unresponsive', () => logLine('renderer unresponsive'));
  wc.on('responsive', () => logLine('renderer responsive again'));
}

function createMainWindow(ses, distDir) {
  const winIcon = loadWindowIcon(distDir);
  const state = isSmokeTest
    ? { width: 1440, height: 810, maximized: false, mode: 'windowed' }
    : core.parseWindowState(readJson('window-state.json'), displayAreas());
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : { center: true }),
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    fullscreen: state.mode === 'fullscreen',
    fullscreenable: true,
    show: false,
    title: 'Skyhold Isles',
    backgroundColor: '#3d5e27',
    autoHideMenuBar: true,
    ...(winIcon ? { icon: winIcon } : {}),
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools,
    },
  });
  if (state.maximized && state.mode !== 'fullscreen') win.maximize();
  win.once('ready-to-show', () => win.show());
  // The page title would replace the window title; keep the game's name.
  win.on('page-title-updated', (event) => event.preventDefault());
  hardenWebContents(win);
  trackWindowState(win, state);

  const devUrl = process.env.STEAM_DEV_URL;
  const query = process.env.SKYHOLD_QUERY ? `?${process.env.SKYHOLD_QUERY.replace(/^\?/, '')}` : '';
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    // Verify built dist/2d.html exists on disk and serve it directly from file via session protocol.
    const htmlFile = path.join(distDir, '2d.html');
    if (!fs.existsSync(htmlFile)) {
      throw new Error(`Missing built entry ${htmlFile}. Run "npm run build" first.`);
    }
    void win.loadURL(`${BUNDLE_ORIGIN}/2d.html${query}`);
  }

  if (isSmokeTest) {
    // Headless smoke runs never get a real `ready-to-show` paint guarantee: show at once.
    win.show();
    const failedLoads = [];
    win.webContents.on('console-message', (ev) => {
      if (ev && typeof ev === 'object' && 'message' in ev) {
        console.info(`[renderer:${ev.level}] ${ev.message}`);
      }
    });
    win.webContents.on('did-fail-load', (_ev, code, desc, url) => {
      failedLoads.push({ code, desc, url });
      console.error(`[renderer:did-fail-load] ${code} ${desc} ${url}`);
    });
    const expectsGameplay = Boolean(query);
    // SwiftShader on a busy CI box: the title, then the map, can take a while.
    const deadline = Date.now() + 75_000;
    const poll = async () => {
      if (win.isDestroyed()) return;
      try {
        const probe = await win.webContents.executeJavaScript(
          `(() => {
            const bootEl = document.getElementById('boot');
            const boot = bootEl ? bootEl.textContent : null;
            if (bootEl) return { ready: false, boot, href: location.href };
            const hasBridge = Boolean(window.skyholdSteam);
            const hasDesktop = Boolean(window.skyholdDesktop);
            const secureContext = Boolean(window.isSecureContext);
            const isSteamVal = window.skyholdSteam ? window.skyholdSteam.isSteam : null;
            const appIdVal = window.skyholdSteam ? window.skyholdSteam.appId : null;
            if (window.__p0 && typeof window.__p0.artcheck === 'function') {
              const st = typeof window.__p0.state === 'function' ? window.__p0.state() : null;
              const heroSim = window.__p0.hero && typeof window.__p0.hero.state === 'function'
                ? window.__p0.hero.state().sim
                : null;
              return {
                ready: true,
                scene: 'game',
                hasBridge,
                hasDesktop,
                secureContext,
                isSteam: isSteamVal,
                appId: appIdVal,
                art: window.__p0.artcheck(),
                mode: window.__p0.mode,
                wave: st ? st.wave : null,
                hero: heroSim ? heroSim.heroId : null,
              };
            }
            // The title screen comes first in a fresh session: check its PC Quit plank, then go on.
            if (window.__title && !window.__map && typeof window.__title.state === 'function') {
              const phase = window.__title.state().phase;
              if (phase === 'tap') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
              if (phase === 'menu') {
                window.__smokeTitleQuit = Boolean(document.querySelector('[data-testid="title2d-quit"]'));
                const go = document.querySelector('[data-testid="title2d-continue"], [data-testid="title2d-new"]');
                if (go && !window.__smokeTitleGo) {
                  window.__smokeTitleGo = true;
                  setTimeout(() => go.click(), 400);
                }
              }
              return { ready: false, title: phase, href: location.href };
            }
            if (!${JSON.stringify(expectsGameplay)} && window.__map && typeof window.__map.chapters === 'function') {
              const chapters = window.__map.chapters();
              const layout = typeof window.__map.layout === 'function' ? window.__map.layout() : null;
              const islands = Array.isArray(chapters) ? chapters.reduce((n, c) => n + (c.total || 0), 0) : 0;
              if (islands >= 25 && layout !== null) {
                return {
                  ready: true,
                  scene: 'worldMap',
                  hasBridge,
                  hasDesktop,
                  secureContext,
                  isSteam: isSteamVal,
                  appId: appIdVal,
                  islands,
                  titleQuit: window.__smokeTitleQuit === true,
                  storeVisible: Boolean(document.querySelector('[data-testid^="store"], [data-testid="set2d-store"]')),
                };
              }
            }
            return { ready: false, boot, href: location.href };
          })()`,
        );
        if (probe && probe.ready) {
          const achievementsCount = knownAchievementIds ? knownAchievementIds.size : 0;
          const summary = {
            ...probe,
            achievementsLoaded: achievementsCount,
            failedLoads: failedLoads.length,
            devTools,
            menu: Menu.getApplicationMenu() === null ? 'none' : 'app',
          };
          const badScene = probe.scene === 'worldMap' && (!probe.titleQuit || probe.storeVisible);
          if (badScene || !probe.hasBridge || !probe.hasDesktop || !probe.secureContext || failedLoads.length > 0 || achievementsCount < 65) {
            console.error('[smoke] Invariant failed:', JSON.stringify({ summary, failedLoads }));
            app.exit(1);
            return;
          }
          console.info('[smoke]', JSON.stringify(summary));
          app.exit(0);
          return;
        }
        if (Date.now() > deadline) {
          console.error('[smoke] Timed out waiting for scene ready:', JSON.stringify({ probe, failedLoads }));
          app.exit(1);
          return;
        }
      } catch (e) {
        if (Date.now() > deadline) {
          console.error('[smoke] Poll error:', e);
          app.exit(1);
          return;
        }
      }
      setTimeout(poll, 300);
    };
    setTimeout(poll, 400);
  }

  return win;
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    installMenu();
    const distDir = path.resolve(__dirname, '..', 'dist');
    const ses = session.fromPartition(SESSION_PARTITION);
    configureSessionPermissions(ses);
    if (!process.env.STEAM_DEV_URL) {
      registerBundleProtocol(ses, distDir);
    }
    try {
      createMainWindow(ses, distDir);
    } catch (err) {
      logLine(`startup failed: ${err && err.stack ? err.stack : String(err)}`);
      if (!isSmokeTest) dialog.showErrorBox('Skyhold Isles', `The game could not start: ${err instanceof Error ? err.message : String(err)}`);
      app.exit(1);
      return;
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(ses, distDir);
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
