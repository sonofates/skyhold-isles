'use strict';

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
});
