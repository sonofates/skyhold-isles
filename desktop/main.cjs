'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeImage, session } = require('electron');

const DEFAULT_STEAM_APP_ID = 480;
const BUNDLE_ORIGIN = 'http://skyhold.local';
const SESSION_PARTITION = 'persist:skyhold';

function resolveSteamAppId(env = process.env) {
  const raw = env.STEAM_APP_ID;
  if (raw !== undefined && raw !== '') {
    const parsed = Number.parseInt(String(raw).trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_STEAM_APP_ID;
}

function sanitizeSlot(slot) {
  if (typeof slot !== 'string') return null;
  const trimmed = slot.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeAchievementId(id) {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

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

const appId = resolveSteamAppId();
let steamClient = null;
let isSteam = false;
let overlayActive = false;

function broadcastOverlay(active) {
  const next = Boolean(active);
  if (next === overlayActive) return;
  overlayActive = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('steam:overlay-changed', overlayActive);
    }
  }
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

  if (process.env.SKYHOLD_SWIFTSHADER === '1' || process.env.SKYHOLD_SMOKE_TEST === '1') {
    app.commandLine.appendSwitch('use-gl', 'angle');
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
  }
  if (process.platform === 'linux') {
    let lowShm = process.env.SKYHOLD_SMOKE_TEST === '1';
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

const isSmokeTest = process.env.SKYHOLD_SMOKE_TEST === '1';
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

function isAllowedAppOrigin(rawOrigin) {
  if (!rawOrigin) return false;
  try {
    const origin = new URL(rawOrigin).origin;
    if (origin === BUNDLE_ORIGIN) return true;
    const devUrl = process.env.STEAM_DEV_URL;
    return Boolean(devUrl && origin === new URL(devUrl).origin);
  } catch {
    return false;
  }
}

function isTrustedIpcSender(event) {
  const senderUrl =
    (event && event.senderFrame && event.senderFrame.url) ||
    (event && event.sender && typeof event.sender.getURL === 'function' ? event.sender.getURL() : '');
  return isAllowedAppOrigin(senderUrl);
}

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

function createMainWindow(ses, distDir) {
  const winIcon = loadWindowIcon(distDir);
  const win = new BrowserWindow({
    width: 1440,
    height: 810,
    minWidth: 960,
    minHeight: 540,
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
      spellcheck: false,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      const u = new URL(targetUrl);
      const devOrigin = process.env.STEAM_DEV_URL ? new URL(process.env.STEAM_DEV_URL).origin : null;
      const allowed = u.origin === BUNDLE_ORIGIN || (devOrigin !== null && u.origin === devOrigin);
      if (!allowed) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

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

  if (process.env.SKYHOLD_SMOKE_TEST === '1') {
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
    const deadline = Date.now() + 25_000;
    const poll = async () => {
      if (win.isDestroyed()) return;
      try {
        const probe = await win.webContents.executeJavaScript(
          `(() => {
            const bootEl = document.getElementById('boot');
            const boot = bootEl ? bootEl.textContent : null;
            if (bootEl) return { ready: false, boot, href: location.href };
            const hasBridge = Boolean(window.skyholdSteam);
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
                secureContext,
                isSteam: isSteamVal,
                appId: appIdVal,
                art: window.__p0.artcheck(),
                mode: window.__p0.mode,
                wave: st ? st.wave : null,
                hero: heroSim ? heroSim.heroId : null,
              };
            }
            if (!${JSON.stringify(expectsGameplay)} && window.__map && typeof window.__map.islands === 'function') {
              const islands = window.__map.islands();
              const layout = typeof window.__map.layout === 'function' ? window.__map.layout() : null;
              if (Array.isArray(islands) && islands.length >= 25 && layout !== null) {
                return {
                  ready: true,
                  scene: 'worldMap',
                  hasBridge,
                  secureContext,
                  isSteam: isSteamVal,
                  appId: appIdVal,
                  islands: islands.length,
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
          };
          if (!probe.hasBridge || !probe.secureContext || failedLoads.length > 0 || achievementsCount < 58) {
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

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    const distDir = path.resolve(__dirname, '..', 'dist');
    const ses = session.fromPartition(SESSION_PARTITION);
    configureSessionPermissions(ses);
    if (!process.env.STEAM_DEV_URL) {
      registerBundleProtocol(ses, distDir);
    }
    createMainWindow(ses, distDir);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(ses, distDir);
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
