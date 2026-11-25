'use strict';

// Sandboxed preload: only `electron` may be required here (no local modules), so the channel names
// are spelled out; tests/platform/desktopShell.test.ts keeps them equal to shellCore.IPC_CHANNELS.
const { contextBridge, ipcRenderer } = require('electron');

const initialStatus = ipcRenderer.sendSync('steam:get-status') || {
  isSteam: false,
  appId: 480,
  overlayActive: false,
};

let overlayActive = Boolean(initialStatus.overlayActive);
const overlayListeners = new Set();

ipcRenderer.on('steam:overlay-changed', (_event, active) => {
  overlayActive = Boolean(active);
  for (const listener of [...overlayListeners]) {
    if (!overlayListeners.has(listener)) continue;
    try {
      listener(overlayActive);
    } catch {
      // ignore listener errors
    }
  }
});

contextBridge.exposeInMainWorld('skyholdSteam', {
  isSteam: Boolean(initialStatus.isSteam),
  appId: Number(initialStatus.appId) || 480,
  unlockAchievement(id) {
    if (typeof id !== 'string') return Promise.resolve(false);
    return ipcRenderer.invoke('steam:unlock-achievement', id);
  },
  cloudRead(slot) {
    if (typeof slot !== 'string') return Promise.resolve(null);
    return ipcRenderer.invoke('steam:cloud-read', slot);
  },
  cloudWrite(slot, json) {
    if (typeof slot !== 'string' || typeof json !== 'string') return Promise.resolve(false);
    return ipcRenderer.invoke('steam:cloud-write', slot, json);
  },
  getOverlayActive() {
    return overlayActive;
  },
  onOverlayChange(listener) {
    if (typeof listener !== 'function') return () => {};
    overlayListeners.add(listener);
    return () => {
      overlayListeners.delete(listener);
    };
  },
  setPresence(state, island) {
    if (typeof state !== 'string') return;
    ipcRenderer.send('steam:set-presence', { state, island: typeof island === 'string' ? island : '' });
  },
});

// The desktop shell itself (with or without Steam): window mode, vsync, quit.
const desktopState = ipcRenderer.sendSync('desktop:get-state') || { mode: 'windowed', vsync: true, platform: 'unknown' };
let windowMode = desktopState.mode === 'fullscreen' ? 'fullscreen' : 'windowed';
const modeListeners = new Set();
ipcRenderer.on('desktop:window-mode-changed', (_event, mode) => {
  windowMode = mode === 'fullscreen' ? 'fullscreen' : 'windowed';
  for (const listener of [...modeListeners]) {
    try {
      listener(windowMode);
    } catch {
      // ignore listener errors
    }
  }
});

contextBridge.exposeInMainWorld('skyholdDesktop', {
  platform: String(desktopState.platform || 'unknown'),
  getWindowMode() {
    return windowMode;
  },
  setWindowMode(mode) {
    if (mode !== 'windowed' && mode !== 'fullscreen') return Promise.resolve(windowMode);
    return ipcRenderer.invoke('desktop:set-window-mode', mode);
  },
  onWindowModeChange(listener) {
    if (typeof listener !== 'function') return () => {};
    modeListeners.add(listener);
    return () => {
      modeListeners.delete(listener);
    };
  },
  getVsync() {
    return desktopState.vsync !== false;
  },
  setVsync(on) {
    if (typeof on !== 'boolean') return Promise.resolve(desktopState.vsync !== false);
    return ipcRenderer.invoke('desktop:set-vsync', on);
  },
  quit() {
    ipcRenderer.send('desktop:quit');
  },
});
