'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session } = require('electron');

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
  const trimmed = String(slot ?? '').trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeAchievementId(id) {
  const trimmed = String(id ?? '').trim();
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
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
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

initSteamworks();

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
  event.returnValue = {
    isSteam,
    appId,
    overlayActive,
  };
});

ipcMain.handle('steam:unlock-achievement', async (_event, rawId) => {
  if (!isSteam || !steamClient) return false;
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

ipcMain.handle('steam:cloud-read', async (_event, rawSlot) => {
  if (!isSteam || !steamClient) return null;
  const slot = sanitizeSlot(rawSlot);
  if (!slot) return null;
  const fileName = `skyhold_${slot}.json`;
  try {
    if (!steamClient.cloud.isEnabledForAccount() || !steamClient.cloud.isEnabledForApp()) {
      return null;
    }
    if (!steamClient.cloud.fileExists(fileName)) return null;
    return steamClient.cloud.readFile(fileName);
  } catch {
    return null;
  }
});

ipcMain.handle('steam:cloud-write', async (_event, rawSlot, rawJson) => {
  if (!isSteam || !steamClient) return false;
  const slot = sanitizeSlot(rawSlot);
  if (!slot || typeof rawJson !== 'string' || rawJson.length > 2 * 1024 * 1024) return false;
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
  const rel = decoded === '/' ? '2d.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(distDir, rel);
  const rootWithSep = distDir.endsWith(path.sep) ? distDir : distDir + path.sep;
  if (resolved !== distDir && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

function registerBundleProtocol(ses, distDir) {
  ses.protocol.handle('http', async (request) => {
    const parsed = new URL(request.url);
    if (parsed.origin !== BUNDLE_ORIGIN) {
      return new Response('Blocked external request', { status: 403 });
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

function createMainWindow(ses, distDir) {
  const iconPath = path.join(distDir, 'icons', 'icon-512.png');
  const win = new BrowserWindow({
    width: 1440,
    height: 810,
    minWidth: 960,
    minHeight: 540,
    title: 'Skyhold Isles',
    backgroundColor: '#3d5e27',
    autoHideMenuBar: true,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
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
    win.webContents.on('console-message', (ev) => {
      if (ev && typeof ev === 'object' && 'message' in ev) {
        console.info(`[renderer:${ev.level}] ${ev.message}`);
      }
    });
    win.webContents.on('did-fail-load', (_ev, code, desc, url) => {
      console.error(`[renderer:did-fail-load] ${code} ${desc} ${url}`);
    });
    const deadline = Date.now() + 20_000;
    const poll = async () => {
      if (win.isDestroyed()) return;
      try {
        const probe = await win.webContents.executeJavaScript(
          `(() => {
            const boot = document.getElementById('boot')?.textContent ?? null;
            if (!window.__p0 || typeof window.__p0.artcheck !== 'function') return { ready: false, boot, href: location.href };
            return {
              ready: true,
              hasBridge: Boolean(window.skyholdSteam),
              isSteam: window.skyholdSteam ? window.skyholdSteam.isSteam : null,
              appId: window.skyholdSteam ? window.skyholdSteam.appId : null,
              art: window.__p0.artcheck(),
              mode: window.__p0.mode,
            };
          })()`,
        );
        if (probe && probe.ready) {
          console.info('[smoke]', JSON.stringify(probe));
          app.exit(0);
          return;
        }
        if (Date.now() > deadline) {
          console.error('[smoke] Timed out waiting for window.__p0:', JSON.stringify(probe));
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

app.whenReady().then(() => {
  const distDir = path.resolve(__dirname, '..', 'dist');
  const ses = session.fromPartition(SESSION_PARTITION);
  if (!process.env.STEAM_DEV_URL) {
    registerBundleProtocol(ses, distDir);
  }
  createMainWindow(ses, distDir);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(ses, distDir);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
